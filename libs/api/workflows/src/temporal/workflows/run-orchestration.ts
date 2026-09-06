import {
  condition,
  defineSignal,
  executeChild,
  log,
  ParentClosePolicy,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import {
  createRuntimeRunProgress,
  type RuntimeRunProgress,
  recordRuntimeJobResult,
  recordSkippedRuntimeJob,
  runtimeJobVersion,
  shouldContinueStartedRun,
} from '#core/workflow-scheduling/run-progress.js';
import type {RuntimeCompletionStatus} from '#core/workflow-scheduling/runtime-dag.js';
import type {RuntimeSchedulingCommand} from '#core/workflow-scheduling/runtime-scheduling-command.js';
import {scheduleRuntimeDag} from '#core/workflow-scheduling/schedule-runtime-dag.js';

import type {createOrchestrationActivities} from '../activities/index.js';
import type {DagJob, RunDag} from '../activities/orchestration-activities.js';
import {RUN_CANCEL_SIGNAL} from '../constants.js';
import {deadlineReached, remainingMs} from './deadline.js';
import {jobExecutionOrchestration} from './job-execution-orchestration.js';
import {jobListenerOrchestration} from './job-listener-orchestration.js';

const {loadRunAttemptDag, evaluateJobActivationsActivity, setRunAttemptStatus, setJobStatus} =
  proxyActivities<ReturnType<typeof createOrchestrationActivities>>({
    startToCloseTimeout: '30s',
  });

const {failRunAsTimedOutActivity} = proxyActivities<
  ReturnType<typeof createOrchestrationActivities>
>({
  startToCloseTimeout: '30s',
  retry: {maximumAttempts: 5},
});

export const runCancelSignal = defineSignal<[]>(RUN_CANCEL_SIGNAL);

export interface RunOrchestrationInput {
  workflowRunId: string;
  runAttemptId: string;
  workspaceId: string;
}

export async function runOrchestration(input: RunOrchestrationInput): Promise<void> {
  let cancelRequested = false;
  setHandler(runCancelSignal, () => {
    cancelRequested = true;
  });

  const dag = await loadRunAttemptDag(input.runAttemptId);
  const runDeadline = Date.now() + dag.runTimeoutMs;

  let runVersion = dag.runVersion;
  const {newVersion, status} = await setRunAttemptStatus({
    runAttemptId: input.runAttemptId,
    status: 'running',
    version: runVersion,
  });
  runVersion = newVersion;
  if (!shouldContinueStartedRun(status)) return;

  const progress = createRuntimeRunProgress(dag.jobs);
  const inFlight = new Map<string, Promise<{job: DagJob; result: LaunchResult}>>();

  while (true) {
    if (cancelRequested) return;
    if (deadlineReached(runDeadline)) {
      await failRunAsTimedOutActivity({runAttemptId: input.runAttemptId});
      return;
    }

    const commands = scheduleRuntimeDag({
      jobs: dag.jobs,
      completed: progress.completed,
      running: new Set(inFlight.keys()),
    });
    const {completeRun, startJobs} = await processRunCommands(
      commands,
      input.runAttemptId,
      progress,
    );
    launchScheduledJobs(startJobs, inFlight, dag, progress);

    if (completeRun) {
      await setRunAttemptStatus({
        runAttemptId: input.runAttemptId,
        status: completeRun.status,
        version: runVersion,
      });
      return;
    }

    if (startJobs.size === 0 && inFlight.size === 0) continue;

    const settled = await waitForNextSettlement(inFlight, () => cancelRequested, runDeadline);
    if (settled.kind === 'cancelled') {
      return;
    }
    if (settled.kind === 'timed-out') {
      await failRunAsTimedOutActivity({runAttemptId: input.runAttemptId});
      return;
    }
    inFlight.delete(settled.job.key);
    recordRuntimeJobResult(settled.job, progress, settled.result);
  }
}

type RuntimeRunCommand = RuntimeSchedulingCommand<DagJob>;

async function processRunCommands(
  commands: readonly RuntimeRunCommand[],
  runAttemptId: string,
  progress: RuntimeRunProgress,
) {
  const startJobs = new Map<string, DagJob>();
  await applySkippedJobCommands(commands, progress);
  await applyActivationCommands(commands, runAttemptId, progress, startJobs);
  for (const command of commands) {
    if (command.kind === 'start-job') startJobs.set(command.job.key, command.job);
  }
  return {
    completeRun: commands.find((command) => command.kind === 'complete-run'),
    startJobs,
  };
}

async function applySkippedJobCommands(
  commands: readonly RuntimeRunCommand[],
  progress: RuntimeRunProgress,
): Promise<void> {
  for (const command of commands) {
    if (command.kind === 'skip-job') {
      await skipJob(command.job, progress, command.statusReason);
    }
  }
}

async function applyActivationCommands(
  commands: readonly RuntimeRunCommand[],
  runAttemptId: string,
  progress: RuntimeRunProgress,
  startJobs: Map<string, DagJob>,
): Promise<void> {
  for (const command of commands) {
    if (command.kind !== 'evaluate-job-activation') continue;
    await applyActivationCommand(command, runAttemptId, progress, startJobs);
  }
}

async function applyActivationCommand(
  command: Extract<RuntimeRunCommand, {kind: 'evaluate-job-activation'}>,
  runAttemptId: string,
  progress: RuntimeRunProgress,
  startJobs: Map<string, DagJob>,
): Promise<void> {
  const activationJobsById = new Map(command.jobs.map((job) => [job.id, job]));
  const decisions = await evaluateJobActivationsActivity({
    runAttemptId,
    jobs: command.jobs.map((job) => ({
      jobId: job.id,
      expectedVersion: runtimeJobVersion(job, progress),
    })),
  });
  for (const decision of decisions) {
    const job = activationJobsById.get(decision.jobId);
    if (!job) continue;
    if (decision.kind === 'start-job') {
      startJobs.set(job.key, job);
      continue;
    }
    recordRuntimeJobResult(job, progress, {
      status: decision.status,
      jobVersion: decision.jobVersion,
    });
  }
}

function launchScheduledJobs(
  startJobs: ReadonlyMap<string, DagJob>,
  inFlight: Map<string, Promise<{job: DagJob; result: LaunchResult}>>,
  dag: RunDag,
  progress: RuntimeRunProgress,
): void {
  for (const job of startJobs.values()) {
    if (!inFlight.has(job.key)) inFlight.set(job.key, launchJob(job, dag, progress));
  }
}

async function skipJob(
  job: DagJob,
  progress: RuntimeRunProgress,
  statusReason: 'default_gate_rejected',
): Promise<void> {
  const version = runtimeJobVersion(job, progress);
  const {newVersion} = await setJobStatus({
    jobId: job.id,
    status: 'skipped',
    version,
    statusReason,
  });
  recordSkippedRuntimeJob(job, progress, newVersion);
}

interface LaunchResult {
  status: RuntimeCompletionStatus;
  jobVersion: number;
}

function launchJob(
  job: DagJob,
  run: RunDag,
  progress: RuntimeRunProgress,
): Promise<{job: DagJob; result: LaunchResult}> {
  if (job.mode === 'listening') return launchListenerJob(job, run, progress);
  return launchOneShotJob(job, run, progress);
}

function launchListenerJob(
  job: DagJob,
  run: RunDag,
  progress: RuntimeRunProgress,
): Promise<{job: DagJob; result: LaunchResult}> {
  return executeChild(jobListenerOrchestration, {
    workflowId: `job-listener:${job.id}`,
    args: [
      {
        jobId: job.id,
        runAttemptId: run.runAttemptId,
        jobVersion: runtimeJobVersion(job, progress),
        ...(job.executionTimeoutMs === undefined
          ? {}
          : {executionTimeoutMs: job.executionTimeoutMs}),
        ...(job.listeningTimeoutMs === undefined
          ? {}
          : {listeningTimeoutMs: job.listeningTimeoutMs}),
        ...(job.maxExecutions === undefined ? {} : {maxExecutions: job.maxExecutions}),
        ...(job.onResolve === undefined ? {} : {onResolve: job.onResolve}),
        ...(job.batchDebounceMs === undefined ? {} : {batchDebounceMs: job.batchDebounceMs}),
        ...(job.batchMaxSize === undefined ? {} : {batchMaxSize: job.batchMaxSize}),
        ...(job.batchMaxWaitMs === undefined ? {} : {batchMaxWaitMs: job.batchMaxWaitMs}),
        requiredLabels: job.runner,
      },
    ],
    parentClosePolicy: ParentClosePolicy.TERMINATE,
  })
    .then((result) => ({job, result}))
    .catch((error) => failListenerJob(job, progress, error));
}

async function failListenerJob(
  job: DagJob,
  progress: RuntimeRunProgress,
  error: unknown,
): Promise<{job: DagJob; result: LaunchResult}> {
  log.warn('listener child failed; marking runtime job failed', {
    jobId: job.id,
    error: String(error),
  });
  const failed = await setJobStatus({
    jobId: job.id,
    status: 'failed',
    version: runtimeJobVersion(job, progress),
    statusReason: listenerFailureStatusReason(error),
  });
  return {job, result: {status: 'failed', jobVersion: failed.newVersion}};
}

function listenerFailureStatusReason(error: unknown): 'output_too_large' | 'unknown' {
  return hasErrorType(error, 'WorkflowExecutionPayloadTooLargeError')
    ? 'output_too_large'
    : 'unknown';
}

function hasErrorType(error: unknown, type: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    readonly type?: unknown;
    readonly cause?: unknown;
    readonly failure?: unknown;
  };
  if (candidate.type === type) return true;
  if (hasApplicationFailureType(candidate.failure, type)) return true;
  return hasErrorType(candidate.cause, type) || hasErrorType(candidate.failure, type);
}

function hasApplicationFailureType(failure: unknown, type: string): boolean {
  if (typeof failure !== 'object' || failure === null) return false;
  const applicationFailureInfo = (failure as {readonly applicationFailureInfo?: unknown})
    .applicationFailureInfo;
  if (typeof applicationFailureInfo !== 'object' || applicationFailureInfo === null) return false;
  return (applicationFailureInfo as {readonly type?: unknown}).type === type;
}

function launchOneShotJob(
  job: DagJob,
  run: RunDag,
  progress: RuntimeRunProgress,
): Promise<{job: DagJob; result: LaunchResult}> {
  if (job.jobExecutionId === undefined)
    throw new Error(`Cannot start job without an execution: ${job.id}`);
  return executeChild(jobExecutionOrchestration, {
    workflowId: `job:${job.id}`,
    args: [
      {
        jobId: job.id,
        jobExecutionId: job.jobExecutionId,
        runAttemptId: run.runAttemptId,
        jobVersion: runtimeJobVersion(job, progress),
        executionVersion: job.executionVersion ?? runtimeJobVersion(job, progress),
        ...(job.executionTimeoutMs === undefined
          ? {}
          : {executionTimeoutMs: job.executionTimeoutMs}),
        requiredLabels: job.runner,
      },
    ],
    parentClosePolicy: ParentClosePolicy.TERMINATE,
  }).then((result) => ({
    job,
    result: {status: result.status, jobVersion: result.jobVersion},
  }));
}

async function waitForNextSettlement(
  inFlight: ReadonlyMap<string, Promise<{job: DagJob; result: LaunchResult}>>,
  isCancelRequested: () => boolean,
  runDeadline: number,
): Promise<
  {kind: 'settled'; job: DagJob; result: LaunchResult} | {kind: 'cancelled'} | {kind: 'timed-out'}
> {
  const remaining = remainingMs(runDeadline) ?? 0;
  const childSettled = Promise.race([...inFlight.values()]).then((settled) => ({
    kind: 'settled' as const,
    ...settled,
  }));
  const cancel = condition(isCancelRequested, remaining).then((woke) =>
    woke ? {kind: 'cancelled' as const} : {kind: 'timed-out' as const},
  );
  return await Promise.race([childSettled, cancel]);
}
