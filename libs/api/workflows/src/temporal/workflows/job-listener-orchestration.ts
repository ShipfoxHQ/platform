import {
  CancellationScope,
  condition,
  continueAsNew,
  defineSignal,
  executeChild,
  log,
  ParentClosePolicy,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import type {ResolutionReason} from '#core/entities/job.js';
import {runtimeStatusForTerminalJobExecutionStatus} from '#core/job-execution-outcome.js';
import type {RuntimeCompletionStatus} from '#core/workflow-scheduling/runtime-dag.js';
import type {createOrchestrationActivities} from '../activities/index.js';
import {LISTENER_EVENTS_AVAILABLE_SIGNAL, LISTENER_RESOLVE_SIGNAL} from '../constants.js';
import {deadlineReached, remainingMs} from './deadline.js';
import {jobExecutionOrchestration} from './job-execution-orchestration.js';

const {
  activateJobListenerActivity,
  drainListenerEventsActivity,
  peekListenerBufferActivity,
  resolveJobListenerActivity,
  settleListenerJobExecutionActivity,
  recordListenerFiringOutcomeActivity,
} = proxyActivities<ReturnType<typeof createOrchestrationActivities>>({
  startToCloseTimeout: '30s',
});

export const listenerEventsAvailableSignal = defineSignal<[]>(LISTENER_EVENTS_AVAILABLE_SIGNAL);
export const listenerResolveSignal = defineSignal<[]>(LISTENER_RESOLVE_SIGNAL);

export interface JobListenerOrchestrationInput {
  workspaceId: string;
  workflowRunId: string;
  projectId: string;
  runAttemptId: string;
  jobId: string;
  jobVersion: number;
  requiredLabels: string[];
  executionTimeoutMs?: number | null | undefined;
  listeningTimeoutMs?: number | null | undefined;
  maxExecutions?: number | null | undefined;
  onResolve?: 'finish' | 'cancel' | null | undefined;
  batchDebounceMs?: number | null | undefined;
  batchMaxSize?: number | null | undefined;
  batchMaxWaitMs?: number | null | undefined;
  continuation?: ListenerContinuationState | undefined;
}

export interface JobListenerOrchestrationResult {
  status: RuntimeCompletionStatus;
  jobVersion: number;
}

type ResolutionLatch = Exclude<ResolutionReason, 'cancelled'> | undefined;
type BatchFiringDecision = 'fire' | 'resolve' | 'deadline';

export interface ListenerContinuationState {
  nextSequence: number;
  latchedReason?: ResolutionLatch;
  listenerDeadline?: number | undefined;
}

export const LISTENER_CONTINUE_AS_NEW_FIRING_LIMIT = 500;

interface ListenerBatchConfig {
  debounceMs?: number | undefined;
  maxSizeEvents?: number | undefined;
  maxWaitMs?: number | undefined;
}

interface BatchFiringWindowParams {
  jobId: string;
  batchConfig: ListenerBatchConfig;
  listenerDeadline: number | undefined;
  hasEventsHint: () => boolean;
  clearEventsHint: () => void;
  hasResolutionHint: () => boolean;
}

interface ListenerBufferPeek {
  fireCount: number;
  resolvePending: boolean;
  oldestAgeMs: number;
  newestAgeMs: number;
}

export async function jobListenerOrchestration(
  input: JobListenerOrchestrationInput,
): Promise<JobListenerOrchestrationResult> {
  let eventsAvailable = false;
  let latchedReason = input.continuation?.latchedReason;

  setHandler(listenerEventsAvailableSignal, () => {
    eventsAvailable = true;
  });
  setHandler(listenerResolveSignal, () => {
    latchedReason = 'until';
  });

  const listenerDeadline = input.continuation?.listenerDeadline ?? initialListenerDeadline(input);

  let nextSequence: number;
  if (input.continuation) {
    nextSequence = input.continuation.nextSequence;
  } else {
    const activated = await activateJobListenerActivity({
      jobId: input.jobId,
      expectedVersion: input.jobVersion,
    });
    if (activated.status === 'terminal') {
      return {
        status: runtimeStatusForTerminalJobExecutionStatus(activated.jobStatus),
        jobVersion: activated.jobVersion,
      };
    }
    nextSequence = activated.executionCount + 1;
  }

  let firingsInCurrentRun = 0;
  const maxExecutions = input.maxExecutions ?? undefined;
  const batchConfig = listenerBatchConfig(input);
  while (true) {
    if (deadlineReached(listenerDeadline)) latchedReason ??= 'timeout';
    await continueListenerAsNewIfNeeded({
      input,
      nextSequence,
      latchedReason,
      listenerDeadline,
      firingsInCurrentRun,
    });
    if (latchedReason !== undefined) break;
    if (maxExecutions !== undefined) {
      if (nextSequence > maxExecutions) {
        latchedReason = 'max_executions';
        await continueListenerAsNewIfNeeded({
          input,
          nextSequence,
          latchedReason,
          listenerDeadline,
          firingsInCurrentRun,
        });
        break;
      }
    }

    if (batchConfig !== undefined) {
      const decision = await awaitBatchFiringWindow({
        jobId: input.jobId,
        batchConfig,
        listenerDeadline,
        hasEventsHint: () => eventsAvailable,
        clearEventsHint: () => {
          eventsAvailable = false;
        },
        hasResolutionHint: () => latchedReason !== undefined,
      });
      if (decision === 'resolve') {
        latchedReason ??= 'until';
        break;
      }
      if (decision === 'deadline') {
        latchedReason ??= 'timeout';
        break;
      }
    }

    eventsAvailable = false;
    const drained = await drainListenerEventsActivity({
      jobId: input.jobId,
      expectedSequence: nextSequence,
      ...(batchConfig?.maxSizeEvents === undefined ? {} : {maxSize: batchConfig.maxSizeEvents}),
    });

    if (drained.kind === 'resolve-requested') {
      latchedReason = 'until';
      break;
    }

    if (drained.kind === 'empty') {
      const woke = await waitForListenerWakeup(
        () => eventsAvailable || latchedReason !== undefined,
        {deadline: listenerDeadline},
      );
      if (!woke && deadlineReached(listenerDeadline)) latchedReason = 'timeout';
      continue;
    }

    if (drained.status === 'failed') {
      await recordListenerFiringOutcomeActivity({outcome: 'failed'});
      nextSequence = drained.sequence + 1;
      firingsInCurrentRun += 1;
      if (maxExecutions !== undefined && drained.sequence >= maxExecutions) {
        latchedReason = 'max_executions';
      }
      continue;
    }

    await runListenerExecution({
      input,
      jobExecutionId: drained.jobExecutionId,
      executionVersion: drained.executionVersion,
      requiredLabels: drained.requiredLabels,
      shouldCancelForResolution: () =>
        input.onResolve === 'cancel' &&
        (latchedReason !== undefined || deadlineReached(listenerDeadline)),
      waitForResolution: () =>
        waitForListenerWakeup(
          () => latchedReason !== undefined || deadlineReached(listenerDeadline),
          {deadline: listenerDeadline},
        ),
    });

    if (deadlineReached(listenerDeadline)) latchedReason ??= 'timeout';
    nextSequence = drained.sequence + 1;
    firingsInCurrentRun += 1;
    if (maxExecutions !== undefined && drained.sequence >= maxExecutions) {
      latchedReason = 'max_executions';
    }
  }

  const reason = latchedReason ?? 'timeout';
  const resolved = await resolveJobListenerActivity({jobId: input.jobId, reason});
  return {status: resolved.status, jobVersion: resolved.jobVersion};
}

function initialListenerDeadline(input: JobListenerOrchestrationInput): number | undefined {
  return input.listeningTimeoutMs === undefined || input.listeningTimeoutMs === null
    ? undefined
    : Date.now() + input.listeningTimeoutMs;
}

async function continueListenerAsNewIfNeeded(params: {
  input: JobListenerOrchestrationInput;
  nextSequence: number;
  latchedReason: ResolutionLatch;
  listenerDeadline: number | undefined;
  firingsInCurrentRun: number;
}): Promise<void> {
  if (
    !shouldContinueListenerAsNew({
      firingsInCurrentRun: params.firingsInCurrentRun,
      continueAsNewSuggested: workflowInfo().continueAsNewSuggested,
    })
  ) {
    return;
  }

  await continueAsNew<typeof jobListenerOrchestration>(
    listenerContinuationInput(params.input, {
      nextSequence: params.nextSequence,
      latchedReason: params.latchedReason,
      listenerDeadline: params.listenerDeadline,
    }),
  );
}

export function shouldContinueListenerAsNew(params: {
  firingsInCurrentRun: number;
  continueAsNewSuggested: boolean;
}): boolean {
  return (
    params.continueAsNewSuggested ||
    params.firingsInCurrentRun >= LISTENER_CONTINUE_AS_NEW_FIRING_LIMIT
  );
}

export function listenerContinuationInput(
  input: JobListenerOrchestrationInput,
  continuation: ListenerContinuationState,
): JobListenerOrchestrationInput {
  return {...input, continuation};
}

function listenerBatchConfig(
  input: JobListenerOrchestrationInput,
): ListenerBatchConfig | undefined {
  const debounceMs = positiveNumber(input.batchDebounceMs);
  const maxSizeEvents = positiveNumber(input.batchMaxSize);
  const maxWaitMs = positiveNumber(input.batchMaxWaitMs);
  if (debounceMs === undefined && maxSizeEvents === undefined && maxWaitMs === undefined) {
    return undefined;
  }
  return {debounceMs, maxSizeEvents, maxWaitMs};
}

async function awaitBatchFiringWindow(
  params: BatchFiringWindowParams,
): Promise<BatchFiringDecision> {
  while (true) {
    const prePeekDecision = resolutionOrDeadlineDecision(params);
    if (prePeekDecision !== undefined) return prePeekDecision;

    const peek = await peekBatchBuffer(params);
    const peekDecision = bufferedResolveOrDeadlineDecision(params, peek);
    if (peekDecision !== undefined) return peekDecision;

    if (peek.fireCount === 0) {
      const waitDecision = await waitForAnyBatchWakeup(params);
      if (waitDecision !== undefined) return waitDecision;
      continue;
    }

    if (batchIsReadyToFire(params.batchConfig, peek)) return 'fire';

    const sleepMs = nextBatchWindowMs(params.batchConfig, peek);
    if (sleepMs === undefined) {
      const waitDecision = await waitForAnyBatchWakeup(params);
      if (waitDecision !== undefined) return waitDecision;
      continue;
    }

    const waitDecision = await waitForBatchWindow(params, sleepMs);
    if (waitDecision !== undefined) return waitDecision;
  }
}

function resolutionOrDeadlineDecision(
  params: BatchFiringWindowParams,
): Exclude<BatchFiringDecision, 'fire'> | undefined {
  if (params.hasResolutionHint()) return 'resolve';
  if (deadlineReached(params.listenerDeadline)) return 'deadline';
  return undefined;
}

async function peekBatchBuffer(params: BatchFiringWindowParams): Promise<ListenerBufferPeek> {
  params.clearEventsHint();
  return await peekListenerBufferActivity({jobId: params.jobId});
}

function bufferedResolveOrDeadlineDecision(
  params: BatchFiringWindowParams,
  peek: ListenerBufferPeek,
): Exclude<BatchFiringDecision, 'fire'> | undefined {
  if (peek.resolvePending || params.hasResolutionHint()) return 'resolve';
  if (deadlineReached(params.listenerDeadline)) return 'deadline';
  return undefined;
}

function batchIsReadyToFire(config: ListenerBatchConfig, peek: ListenerBufferPeek): boolean {
  const sizeReached = config.maxSizeEvents !== undefined && peek.fireCount >= config.maxSizeEvents;
  const debounceQuiet = config.debounceMs !== undefined && peek.newestAgeMs >= config.debounceMs;
  const maxWaitReached = config.maxWaitMs !== undefined && peek.oldestAgeMs >= config.maxWaitMs;
  return sizeReached || debounceQuiet || maxWaitReached;
}

function nextBatchWindowMs(
  config: ListenerBatchConfig,
  peek: ListenerBufferPeek,
): number | undefined {
  const timeWindows = [
    remainingWindowMs(config.debounceMs, peek.newestAgeMs),
    remainingWindowMs(config.maxWaitMs, peek.oldestAgeMs),
  ].filter((value): value is number => value !== undefined);
  return timeWindows.length === 0 ? undefined : Math.min(...timeWindows);
}

async function waitForAnyBatchWakeup(
  params: BatchFiringWindowParams,
): Promise<Exclude<BatchFiringDecision, 'fire'> | undefined> {
  const woke = await waitForListenerWakeup(
    () => params.hasEventsHint() || params.hasResolutionHint(),
    {deadline: params.listenerDeadline},
  );
  if (!woke && deadlineReached(params.listenerDeadline)) return 'deadline';
  return undefined;
}

async function waitForBatchWindow(
  params: BatchFiringWindowParams,
  sleepMs: number,
): Promise<Exclude<BatchFiringDecision, 'fire'> | undefined> {
  const deadlineRemaining = remainingMs(params.listenerDeadline);
  const boundedSleepMs =
    deadlineRemaining === undefined ? sleepMs : Math.min(sleepMs, deadlineRemaining);
  const wakesOnEvents =
    params.batchConfig.debounceMs !== undefined || params.batchConfig.maxSizeEvents !== undefined;
  const woke = await condition(
    () =>
      params.hasResolutionHint() ||
      (wakesOnEvents && params.hasEventsHint()) ||
      deadlineReached(params.listenerDeadline),
    boundedSleepMs,
  );
  if (!woke && deadlineReached(params.listenerDeadline)) return 'deadline';
  return undefined;
}

function positiveNumber(value: number | null | undefined): number | undefined {
  return value === undefined || value === null || value <= 0 ? undefined : value;
}

function remainingWindowMs(limitMs: number | undefined, ageMs: number): number | undefined {
  return limitMs === undefined ? undefined : Math.max(0, limitMs - ageMs);
}

async function runListenerExecution(params: {
  input: JobListenerOrchestrationInput;
  jobExecutionId: string;
  executionVersion: number;
  requiredLabels: string[];
  shouldCancelForResolution: () => boolean;
  waitForResolution: () => Promise<boolean>;
}): Promise<void> {
  const scope = new CancellationScope();
  const child = scope.run(() =>
    executeChild(jobExecutionOrchestration, {
      workflowId: `job:${params.input.jobId}`,
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
      args: [
        {
          workspaceId: params.input.workspaceId,
          workflowRunId: params.input.workflowRunId,
          projectId: params.input.projectId,
          jobId: params.input.jobId,
          jobExecutionId: params.jobExecutionId,
          runAttemptId: params.input.runAttemptId,
          jobVersion: params.input.jobVersion,
          executionVersion: params.executionVersion,
          ...(params.input.executionTimeoutMs === undefined
            ? {}
            : {executionTimeoutMs: params.input.executionTimeoutMs}),
          resolveJobStatus: false,
          requiredLabels: params.requiredLabels,
        },
      ],
      parentClosePolicy: ParentClosePolicy.TERMINATE,
    }),
  );

  if (params.input.onResolve === 'cancel') {
    const winner = await Promise.race([
      child.then(
        () => 'child' as const,
        () => 'child-failed' as const,
      ),
      params.waitForResolution().then(() => 'resolution' as const),
    ]);
    if (winner === 'resolution' && params.shouldCancelForResolution()) {
      scope.cancel();
      await settleListenerJobExecutionActivity({
        jobExecutionId: params.jobExecutionId,
        status: 'cancelled',
      });
      await recordListenerFiringOutcomeActivity({outcome: 'cancelled'});
      return;
    }
  }

  try {
    const result = await child;
    await recordListenerFiringOutcomeActivity({outcome: listenerFiringOutcome(result.status)});
  } catch (error) {
    log.warn('listener execution child failed; recording failed firing and continuing', {
      jobId: params.input.jobId,
      jobExecutionId: params.jobExecutionId,
      error: String(error),
    });
    await settleListenerJobExecutionActivity({
      jobExecutionId: params.jobExecutionId,
      status: 'failed',
    });
    await recordListenerFiringOutcomeActivity({outcome: 'failed'});
  }
}

function listenerFiringOutcome(
  status: RuntimeCompletionStatus,
): 'succeeded' | 'failed' | 'cancelled' {
  if (status === 'succeeded' || status === 'failed' || status === 'cancelled') return status;
  throw new Error(`Listener execution cannot finish with status: ${status}`);
}

async function waitForListenerWakeup(
  predicate: () => boolean,
  options: {deadline: number | undefined},
): Promise<boolean> {
  const remaining = remainingMs(options.deadline);
  if (remaining !== undefined && remaining <= 0) return false;
  if (remaining === undefined) {
    await condition(predicate);
    return true;
  }
  return await condition(predicate, remaining);
}
