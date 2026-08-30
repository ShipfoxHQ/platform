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

interface ListenerRuntimeState {
  eventsAvailable: boolean;
  latchedReason: ResolutionLatch;
  nextSequence: number;
  firingsInCurrentRun: number;
}

export async function jobListenerOrchestration(
  input: JobListenerOrchestrationInput,
): Promise<JobListenerOrchestrationResult> {
  const state: ListenerRuntimeState = {
    eventsAvailable: false,
    latchedReason: input.continuation?.latchedReason,
    nextSequence: input.continuation?.nextSequence ?? 1,
    firingsInCurrentRun: 0,
  };

  setHandler(listenerEventsAvailableSignal, () => {
    state.eventsAvailable = true;
  });
  setHandler(listenerResolveSignal, () => {
    state.latchedReason = 'until';
  });

  const listenerDeadline = input.continuation?.listenerDeadline ?? initialListenerDeadline(input);
  const terminal = await initializeListenerState(input, state);
  if (terminal) return terminal;

  const maxExecutions = input.maxExecutions ?? undefined;
  const batchConfig = listenerBatchConfig(input);
  while (await prepareListenerIteration(input, state, listenerDeadline, maxExecutions)) {
    const batchReady = await waitForConfiguredBatch(input, state, listenerDeadline, batchConfig);
    if (!batchReady) break;
    const continueLoop = await drainAndProcessListenerEvents(
      input,
      state,
      listenerDeadline,
      maxExecutions,
      batchConfig,
    );
    if (!continueLoop) break;
  }

  const reason = state.latchedReason ?? 'timeout';
  const resolved = await resolveJobListenerActivity({jobId: input.jobId, reason});
  return {status: resolved.status, jobVersion: resolved.jobVersion};
}

async function initializeListenerState(
  input: JobListenerOrchestrationInput,
  state: ListenerRuntimeState,
): Promise<JobListenerOrchestrationResult | undefined> {
  if (input.continuation) return undefined;
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
  state.nextSequence = activated.executionCount + 1;
  return undefined;
}

async function prepareListenerIteration(
  input: JobListenerOrchestrationInput,
  state: ListenerRuntimeState,
  listenerDeadline: number | undefined,
  maxExecutions: number | undefined,
): Promise<boolean> {
  if (deadlineReached(listenerDeadline)) state.latchedReason ??= 'timeout';
  await continueListenerAsNewIfNeeded({
    input,
    nextSequence: state.nextSequence,
    latchedReason: state.latchedReason,
    listenerDeadline,
    firingsInCurrentRun: state.firingsInCurrentRun,
  });
  if (state.latchedReason !== undefined) return false;
  if (maxExecutions === undefined || state.nextSequence <= maxExecutions) return true;

  state.latchedReason = 'max_executions';
  await continueListenerAsNewIfNeeded({
    input,
    nextSequence: state.nextSequence,
    latchedReason: state.latchedReason,
    listenerDeadline,
    firingsInCurrentRun: state.firingsInCurrentRun,
  });
  return false;
}

async function waitForConfiguredBatch(
  input: JobListenerOrchestrationInput,
  state: ListenerRuntimeState,
  listenerDeadline: number | undefined,
  batchConfig: ListenerBatchConfig | undefined,
): Promise<boolean> {
  if (batchConfig === undefined) return true;
  const decision = await awaitBatchFiringWindow({
    jobId: input.jobId,
    batchConfig,
    listenerDeadline,
    hasEventsHint: () => state.eventsAvailable,
    clearEventsHint: () => {
      state.eventsAvailable = false;
    },
    hasResolutionHint: () => state.latchedReason !== undefined,
  });
  if (decision === 'fire') return true;
  state.latchedReason ??= decision === 'resolve' ? 'until' : 'timeout';
  return false;
}

async function drainAndProcessListenerEvents(
  input: JobListenerOrchestrationInput,
  state: ListenerRuntimeState,
  listenerDeadline: number | undefined,
  maxExecutions: number | undefined,
  batchConfig: ListenerBatchConfig | undefined,
): Promise<boolean> {
  state.eventsAvailable = false;
  const drained = await drainListenerEventsActivity({
    jobId: input.jobId,
    expectedSequence: state.nextSequence,
    ...(batchConfig?.maxSizeEvents === undefined ? {} : {maxSize: batchConfig.maxSizeEvents}),
  });
  if (drained.kind === 'resolve-requested') {
    state.latchedReason = 'until';
    return false;
  }
  if (drained.kind === 'empty') {
    await waitForMoreListenerEvents(state, listenerDeadline);
    return true;
  }
  if (drained.status === 'failed') {
    await recordListenerFiringOutcomeActivity({outcome: 'failed'});
    recordListenerFiring(state, drained.sequence, maxExecutions);
    return true;
  }

  await runListenerExecution({
    input,
    jobExecutionId: drained.jobExecutionId,
    executionVersion: drained.executionVersion,
    requiredLabels: drained.requiredLabels,
    shouldCancelForResolution: () =>
      input.onResolve === 'cancel' &&
      (state.latchedReason !== undefined || deadlineReached(listenerDeadline)),
    waitForResolution: () =>
      waitForListenerWakeup(
        () => state.latchedReason !== undefined || deadlineReached(listenerDeadline),
        {deadline: listenerDeadline},
      ),
  });
  if (deadlineReached(listenerDeadline)) state.latchedReason ??= 'timeout';
  recordListenerFiring(state, drained.sequence, maxExecutions);
  return true;
}

async function waitForMoreListenerEvents(
  state: ListenerRuntimeState,
  listenerDeadline: number | undefined,
): Promise<void> {
  const woke = await waitForListenerWakeup(
    () => state.eventsAvailable || state.latchedReason !== undefined,
    {deadline: listenerDeadline},
  );
  if (!woke && deadlineReached(listenerDeadline)) state.latchedReason = 'timeout';
}

function recordListenerFiring(
  state: ListenerRuntimeState,
  sequence: number,
  maxExecutions: number | undefined,
): void {
  state.nextSequence = sequence + 1;
  state.firingsInCurrentRun += 1;
  if (maxExecutions !== undefined && sequence >= maxExecutions) {
    state.latchedReason = 'max_executions';
  }
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

    const windowDecision = await awaitPeekedBatchWindow(params, peek);
    if (windowDecision !== 'retry') return windowDecision;
  }
}

async function awaitPeekedBatchWindow(
  params: BatchFiringWindowParams,
  peek: ListenerBufferPeek,
): Promise<BatchFiringDecision | 'retry'> {
  if (peek.fireCount === 0) return (await waitForAnyBatchWakeup(params)) ?? 'retry';
  if (batchIsReadyToFire(params.batchConfig, peek)) return 'fire';

  const sleepMs = nextBatchWindowMs(params.batchConfig, peek);
  if (sleepMs === undefined) return (await waitForAnyBatchWakeup(params)) ?? 'retry';
  return (await waitForBatchWindow(params, sleepMs)) ?? 'retry';
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
