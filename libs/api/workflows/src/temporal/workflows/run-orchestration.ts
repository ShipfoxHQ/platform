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
    if (cancelRequested) {
      return;
    }
    if (deadlineReached(runDeadline)) {
      await failRunAsTimedOutActivity({runAttemptId: input.runAttemptId});
      return;
    }

    const commands = scheduleRuntimeDag({
      jobs: dag.jobs,
      completed: progress.completed,
      running: new Set(inFlight.keys()),
    });
    const completeRun = commands.find((command) => command.kind === 'complete-run');
    const startJobs = new Map<string, DagJob>();

    for (const command of commands) {
      if (command.kind !== 'skip-job') continue;
      await skipJob(command.job, progress, command.statusReason);
    }

    for (const command of commands) {
      if (command.kind !== 'evaluate-job-activation') continue;
      const activationJobsById = new Map(command.jobs.map((job) => [job.id, job]));
      const decisions = await evaluateJobActivationsActivity({
        runAttemptId: input.runAttemptId,
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

    for (const command of commands) {
      if (command.kind !== 'start-job') continue;
      startJobs.set(command.job.key, command.job);
    }

    for (const job of startJobs.values()) {
      if (!inFlight.has(job.key)) {
        inFlight.set(job.key, launchJob(job, dag, progress));
      }
    }

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
  if (job.mode === 'listening') {
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
      .catch(async (error) => {
        log.warn('listener child failed; marking runtime job failed', {
          jobId: job.id,
          error: String(error),
        });
        const failed = await setJobStatus({
          jobId: job.id,
          status: 'failed',
          version: runtimeJobVersion(job, progress),
          statusReason: 'unknown',
        });
        return {
          job,
          result: {status: 'failed' as const, jobVersion: failed.newVersion},
        };
      });
  }

  if (job.jobExecutionId === undefined) {
    throw new Error(`Cannot start job without an execution: ${job.id}`);
  }
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
