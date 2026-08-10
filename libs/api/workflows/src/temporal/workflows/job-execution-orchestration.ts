import {ApplicationFailure} from '@temporalio/common';
import {condition, defineSignal, log, proxyActivities, setHandler} from '@temporalio/workflow';
import {
  hasNoRequiredRunnerLabels,
  type JobExecutionOutcomeSignals,
  jobExecutionStartOutcome,
  resolveJobExecutionOutcomeSignal,
} from '#core/job-execution-outcome.js';
import type {RuntimeCompletionStatus} from '#core/workflow-scheduling/runtime-dag.js';

import type {createOrchestrationActivities} from '../activities/index.js';
import {JOB_CLAIMED_SIGNAL, JOB_FINISHED_SIGNAL, JOB_LEASE_EXPIRED_SIGNAL} from '../constants.js';
import {remainingMs} from './deadline.js';

/**
 * Enqueue, wait for the runner claim, then wait for one of the terminal facts:
 *
 *   enqueue ──> PENDING ── job-claimed ──> RUNNING
 *                 │                          │
 *                 │ timeout                  ├─ job-finished
 *                 │                          ├─ job-lease-expired
 *                 ▼                          └─ timeout
 *              TERMINAL
 *
 * The claim signal is the runner-owned lifecycle boundary. The workflow keeps the
 * execution pending while it is queued, then performs the versioned pending → running
 * transition after the current claim. One deadline spans both waits; claim never resets
 * it. Signals can arrive in any order, so the precedence is finished > lease expired >
 * claimed > timeout. Lease cleanup remains best-effort: a runners DB outage must never
 * block the child workflow from returning the job outcome to run-orchestration.
 */

const {
  setJobStatus,
  setJobExecutionStatus,
  enqueueJobExecutionForRunner,
  bulkSetStepStatuses,
  failJobExecutionAsTimedOutActivity,
  resolveLeaseExpiredJobExecutionActivity,
} = proxyActivities<ReturnType<typeof createOrchestrationActivities>>({
  startToCloseTimeout: '30s',
});

const {resolveJobStatusFromJobExecutionsActivity} = proxyActivities<
  ReturnType<typeof createOrchestrationActivities>
>({
  startToCloseTimeout: '30s',
  retry: {maximumAttempts: 5},
});

// Lease cleanup gets a bounded retry policy of its own: after a few attempts the
// workflow stops waiting on it (see releaseLeaseBestEffort) rather than blocking
// the DAG on runners-side availability.
const {releaseLeaseActivity} = proxyActivities<ReturnType<typeof createOrchestrationActivities>>({
  startToCloseTimeout: '30s',
  retry: {maximumAttempts: 5},
});

const DEFAULT_EXECUTION_MAX_DURATION_MS = 6 * 60 * 60 * 1000;

export const jobFinishedSignal =
  defineSignal<[{status: RuntimeCompletionStatus; jobExecutionId?: string | undefined}]>(
    JOB_FINISHED_SIGNAL,
  );
export const jobLeaseExpiredSignal =
  defineSignal<[{jobExecutionId?: string | undefined}]>(JOB_LEASE_EXPIRED_SIGNAL);
export interface JobClaimedSignalPayload {
  jobExecutionId: string;
  claimedAt: string;
}
export const jobClaimedSignal = defineSignal<[JobClaimedSignalPayload]>(JOB_CLAIMED_SIGNAL);

export interface JobExecutionOrchestrationInput {
  workspaceId: string;
  workflowRunId: string;
  runAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  projectId: string;
  jobVersion: number;
  executionVersion: number;
  executionTimeoutMs?: number | null | undefined;
  resolveJobStatus?: boolean | undefined;
  requiredLabels: string[];
}

export interface JobExecutionOrchestrationResult {
  status: RuntimeCompletionStatus;
  jobVersion: number;
}

async function releaseLeaseBestEffort(jobExecutionId: string): Promise<void> {
  try {
    await releaseLeaseActivity({jobExecutionId});
  } catch (err) {
    log.warn('lease release failed; stuck detector will reap the row', {
      jobExecutionId,
      error: String(err),
    });
  }
}

async function resolveJobStatusOrFailClosed(
  input: JobExecutionOrchestrationInput,
): Promise<{status: RuntimeCompletionStatus; jobVersion: number}> {
  try {
    return await resolveJobStatusFromJobExecutionsActivity({jobId: input.jobId});
  } catch (err) {
    log.error('job status resolution failed; failing job closed', {
      jobId: input.jobId,
      jobExecutionId: input.jobExecutionId,
      error: String(err),
    });
    const {newVersion} = await setJobStatus({
      jobId: input.jobId,
      status: 'failed',
      version: input.jobVersion,
      statusReason: 'step_failed',
    });
    return {status: 'failed', jobVersion: newVersion};
  }
}

async function enqueueJobExecution(input: JobExecutionOrchestrationInput): Promise<void> {
  if (hasNoRequiredRunnerLabels(input.requiredLabels)) {
    throw ApplicationFailure.nonRetryable(
      `Job ${input.jobId} has no required runner labels`,
      'EmptyRequiredLabelsError',
    );
  }

  await enqueueJobExecutionForRunner({
    workspaceId: input.workspaceId,
    workflowRunId: input.workflowRunId,
    runAttemptId: input.runAttemptId,
    jobId: input.jobId,
    jobExecutionId: input.jobExecutionId,
    projectId: input.projectId,
    requiredLabels: input.requiredLabels,
  });
}

async function markJobExecutionRunning(
  input: JobExecutionOrchestrationInput,
): Promise<
  | {kind: 'running'; runningVersion: number}
  | {kind: 'terminal'; result: JobExecutionOrchestrationResult}
> {
  const {newVersion: runningVersion, status} = await setJobExecutionStatus({
    jobExecutionId: input.jobExecutionId,
    status: 'running',
    version: input.executionVersion,
  });

  const start = jobExecutionStartOutcome({newVersion: runningVersion, status});
  if (start.kind === 'terminal') return start;
  return {kind: 'running', runningVersion};
}

interface JobExecutionSignals extends JobExecutionOutcomeSignals {
  claimed: JobClaimedSignalPayload | undefined;
}

function registerJobExecutionSignalHandlers(
  jobExecutionId: string,
  signals: JobExecutionSignals,
): void {
  setHandler(jobFinishedSignal, (payload) => {
    if (payload.jobExecutionId !== undefined && payload.jobExecutionId !== jobExecutionId) return;
    signals.finished ??= payload;
  });
  setHandler(jobLeaseExpiredSignal, (payload = {}) => {
    if (payload.jobExecutionId !== undefined && payload.jobExecutionId !== jobExecutionId) return;
    signals.leaseExpired = true;
  });
  setHandler(jobClaimedSignal, (payload) => {
    if (payload.jobExecutionId !== jobExecutionId) return;
    signals.claimed ??= payload;
  });
}

async function waitForJobExecutionSignal(
  signals: JobExecutionSignals,
  deadline: number,
  includeClaim: boolean,
): Promise<void> {
  await condition(
    () =>
      signals.finished !== undefined ||
      signals.leaseExpired ||
      (includeClaim && signals.claimed !== undefined),
    remainingMs(deadline) ?? 0,
  );
}

interface JobExecutionResolution {
  input: JobExecutionOrchestrationInput;
  runningVersion: number;
}

async function resolveFinishedJobExecution({
  input,
  runningVersion,
  status,
}: JobExecutionResolution & {
  status: RuntimeCompletionStatus;
}): Promise<JobExecutionOrchestrationResult> {
  await setJobExecutionStatus({
    jobExecutionId: input.jobExecutionId,
    status: jobExecutionStatusForRuntimeStatus(status),
    version: runningVersion,
    statusReason: status === 'failed' ? 'step_failed' : null,
  });
  if (input.resolveJobStatus === false) {
    log.info('job execution terminated', {
      jobId: input.jobId,
      jobExecutionId: input.jobExecutionId,
      terminationReason: 'finished',
      status,
    });
    await releaseLeaseBestEffort(input.jobExecutionId);
    return {status, jobVersion: input.jobVersion};
  }
  const resolved = await resolveJobStatusOrFailClosed(input);
  log.info('job execution terminated', {
    jobId: input.jobId,
    jobExecutionId: input.jobExecutionId,
    terminationReason: 'finished',
    status: resolved.status,
  });
  await releaseLeaseBestEffort(input.jobExecutionId);
  return resolved;
}

function jobExecutionStatusForRuntimeStatus(
  status: RuntimeCompletionStatus,
): 'succeeded' | 'failed' | 'cancelled' {
  if (status === 'succeeded' || status === 'failed' || status === 'cancelled') return status;
  throw ApplicationFailure.nonRetryable(
    `Job execution cannot be marked ${status}`,
    'InvalidJobExecutionStatusError',
  );
}

async function resolveLeaseExpiredJobExecution({
  input,
  runningVersion,
}: JobExecutionResolution): Promise<JobExecutionOrchestrationResult> {
  const leaseExpired = await resolveLeaseExpiredJobExecutionActivity({
    jobExecutionId: input.jobExecutionId,
    expectedVersion: runningVersion,
  });
  if (input.resolveJobStatus === false) {
    log.info('job execution terminated', {
      jobId: input.jobId,
      jobExecutionId: input.jobExecutionId,
      terminationReason: 'lease_expired',
      status: leaseExpired.status,
    });
    await releaseLeaseBestEffort(input.jobExecutionId);
    return {status: leaseExpired.status, jobVersion: input.jobVersion};
  }
  const {status, jobVersion} = await resolveJobStatusOrFailClosed(input);
  log.info('job execution terminated', {
    jobId: input.jobId,
    jobExecutionId: input.jobExecutionId,
    terminationReason: 'lease_expired',
    status,
  });
  await releaseLeaseBestEffort(input.jobExecutionId);
  return {status, jobVersion};
}

// Timeout backstop. The activity atomically fails the execution, marks `timed_out_at`, and
// enqueues the generic terminal execution fact. The runners subscriber then asks the runner to
// cancel. The lease is intentionally NOT released here.
async function resolveTimedOutJobExecution({
  input,
  runningVersion,
}: JobExecutionResolution): Promise<JobExecutionOrchestrationResult> {
  await failJobExecutionAsTimedOutActivity({
    jobExecutionId: input.jobExecutionId,
    runAttemptId: input.runAttemptId,
    expectedVersion: runningVersion,
  });
  await bulkSetStepStatuses({jobExecutionId: input.jobExecutionId, status: 'failed'});
  if (input.resolveJobStatus === false) {
    log.info('job execution terminated', {
      jobId: input.jobId,
      jobExecutionId: input.jobExecutionId,
      terminationReason: 'max_duration',
      status: 'failed',
    });
    return {status: 'failed', jobVersion: input.jobVersion};
  }
  const {jobVersion} = await resolveJobStatusOrFailClosed(input);
  log.info('job execution terminated', {
    jobId: input.jobId,
    jobExecutionId: input.jobExecutionId,
    terminationReason: 'max_duration',
    status: 'failed',
  });
  return {status: 'failed', jobVersion};
}

export async function jobExecutionOrchestration(
  input: JobExecutionOrchestrationInput,
): Promise<JobExecutionOrchestrationResult> {
  const signals: JobExecutionSignals = {
    finished: undefined,
    leaseExpired: false,
    claimed: undefined,
  };
  // Register every signal before enqueue can block or publish a claim/outcome event. The
  // handlers retain signals that arrive while the enqueue activity is in flight.
  registerJobExecutionSignalHandlers(input.jobExecutionId, signals);
  await enqueueJobExecution(input);

  const timeoutMs = input.executionTimeoutMs ?? DEFAULT_EXECUTION_MAX_DURATION_MS;
  const deadline = Date.now() + timeoutMs;
  await waitForJobExecutionSignal(signals, deadline, true);

  // A terminal fact wins over claim even when both signals arrive before the condition
  // resumes. This prevents a late claim from reopening an execution that already finished.
  let resolution = resolveJobExecutionOutcomeSignal(signals);
  if (resolution === 'finished') {
    const {finished} = signals;
    if (finished === undefined) throw new Error('Missing finished signal for finished resolution');

    return resolveFinishedJobExecution({
      input,
      runningVersion: input.executionVersion,
      status: finished.status,
    });
  }
  if (resolution === 'lease-expired') {
    return resolveLeaseExpiredJobExecution({input, runningVersion: input.executionVersion});
  }
  if (!signals.claimed) {
    return resolveTimedOutJobExecution({input, runningVersion: input.executionVersion});
  }

  const running = await markJobExecutionRunning(input);
  if (running.kind === 'terminal') {
    if (input.resolveJobStatus === false) {
      return {status: running.result.status, jobVersion: input.jobVersion};
    }
    return running.result;
  }
  const {runningVersion} = running;

  await waitForJobExecutionSignal(signals, deadline, false);
  resolution = resolveJobExecutionOutcomeSignal(signals);
  if (resolution === 'finished') {
    const {finished} = signals;
    if (finished === undefined) throw new Error('Missing finished signal for finished resolution');
    return resolveFinishedJobExecution({input, runningVersion, status: finished.status});
  }
  if (resolution === 'lease-expired') {
    return resolveLeaseExpiredJobExecution({input, runningVersion});
  }
  return resolveTimedOutJobExecution({input, runningVersion});
}
