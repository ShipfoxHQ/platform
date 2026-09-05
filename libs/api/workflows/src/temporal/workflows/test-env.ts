import {resolve} from 'node:path';
import {TestWorkflowEnvironment} from '@temporalio/testing';
import {Worker} from '@temporalio/worker';
import type {RuntimeCompletionStatus} from '#core/workflow-scheduling/runtime-dag.js';
import type {JobActivationDecision} from '#db/index.js';
import type {
  ActivateJobListenerResult,
  DrainListenerEventsResult,
  ListenerBufferPeek,
} from '#db/job-listeners.js';
import type {RunDag} from '../activities/orchestration-activities.js';
import {JOB_CLAIMED_SIGNAL, JOB_FINISHED_SIGNAL, JOB_LEASE_EXPIRED_SIGNAL} from '../constants.js';

const TASK_QUEUE = 'test-orchestration';
const WORKFLOWS_PATH = resolve(import.meta.dirname, '../../../dist/temporal/workflows/index.js');

export {TASK_QUEUE};

// ---------------------------------------------------------------------------
// Shared mutable test config: each test sets this before starting a workflow.
// Activities read from it via closure. Tests run serially within a describe.
// ---------------------------------------------------------------------------

export interface TestConfig {
  dag: RunDag;
  /** Map of jobId → status the mock runner should signal back */
  jobResults: Map<string, RuntimeCompletionStatus>;
  /** If set, queueJobExecutionActivity will throw with this message instead of signaling */
  queueError?: string;
  /** If true, queueJobExecutionActivity sends two job-finished signals (for dedup testing) */
  duplicateSignal?: boolean;
  /** If true, queueJobExecutionActivity does nothing without a signal for timeout testing */
  skipSignal?: boolean;
  /** If true, emit the claim but hold back the terminal outcome (for deadline testing) */
  skipOutcomeSignal?: boolean;
  /** Runner-owned claim timestamp used by the mock claim event */
  claimedAt?: string;
  /** If true, signal job-lease-expired instead of job-finished */
  signalLeaseExpired?: boolean;
  /** If true, signal BOTH job-finished and job-lease-expired (precedence testing) */
  signalBoth?: boolean;
  /** Status resolveLeaseExpiredJobExecutionActivity returns (defaults to 'failed') */
  leaseExpiredStatus?: RuntimeCompletionStatus;
  /** If set, resolveJobStatusFromJobExecutionsActivity throws with this message */
  resolveJobStatusError?: string;
  /** Scripted job activation decisions keyed by job id; defaults to start */
  activationDecisions?: Map<string, JobActivationDecision>;
  /** If set, failJobExecutionAsTimedOutActivity throws (for timeout error-path testing) */
  failJobExecutionAsTimedOutError?: string;
  /** Effective status returned by the initial running setRunAttemptStatus call */
  initialRunStatus?: string;
  /** Effective status returned by a running setJobStatus call */
  runningJobStatus?: string;
  /** Result returned by activateJobListenerActivity (defaults to a running listener) */
  listenerActivated?: ActivateJobListenerResult;
  /** If set, listener activation fails with an oversized-payload application failure. */
  listenerActivationError?: string;
  /** Scripted drain results consumed in order; once exhausted, drain returns {kind: 'empty'} */
  drainResults?: DrainListenerEventsResult[];
  /** Scripted listener buffer peeks consumed in order; once exhausted, returns an empty buffer */
  peekResults?: ListenerBufferPeek[];
  /** Result returned by resolveJobListenerActivity (defaults to succeeded) */
  listenerResolved?: {status: 'succeeded' | 'failed'; jobVersion: number};
}

export let cfg: TestConfig;

export function setCfg(value: TestConfig): void {
  cfg = value;
}

// Track every activity call for assertions
export interface ActivityCall {
  name: string;
  params: unknown;
}

export let calls: ActivityCall[];
let versionSeq: number;
const pendingJobOutcomes = new Map<
  string,
  {
    handle: ReturnType<typeof testEnv.client.workflow.getHandle>;
    status: RuntimeCompletionStatus;
    duplicateSignal: boolean;
  }
>();

function nextVersion(): number {
  return ++versionSeq;
}

export function resetCalls(): void {
  calls = [];
  versionSeq = 0;
  pendingJobOutcomes.clear();
}

export function callsNamed(name: string): ActivityCall[] {
  return calls.filter((c) => c.name === name);
}

export function setRunAttemptStatusCalls() {
  return callsNamed('setRunAttemptStatus') as Array<{
    name: string;
    params: {runAttemptId: string; status: string; version: number};
  }>;
}

export function setJobStatusCalls() {
  return callsNamed('setJobStatus') as Array<{
    name: string;
    params: {jobId: string; status: string; version: number; statusReason?: string | null};
  }>;
}

export function setExecutionStatusCalls() {
  return callsNamed('setJobExecutionStatus') as Array<{
    name: string;
    params: {jobExecutionId: string; status: string; version: number; statusReason?: string | null};
  }>;
}

export function listenerFiringOutcomeCalls() {
  return callsNamed('recordListenerFiringOutcomeActivity') as Array<{
    name: string;
    params: {outcome: 'succeeded' | 'failed' | 'cancelled'};
  }>;
}

export function resolveJobListenerCalls() {
  return callsNamed('resolveJobListenerActivity') as Array<{
    name: string;
    params: {jobId: string; reason: string};
  }>;
}

export function settleListenerCalls() {
  return callsNamed('settleListenerJobExecutionActivity') as Array<{
    name: string;
    params: {jobExecutionId: string; status: 'failed' | 'cancelled'};
  }>;
}

// ---------------------------------------------------------------------------
// DAG helpers
// ---------------------------------------------------------------------------

export function dagJob(
  id: string,
  key: string,
  deps: string[] = [],
  options: {
    mode?: RunDag['jobs'][number]['mode'] | undefined;
    status?: RunDag['jobs'][number]['status'] | undefined;
    hasActivationCondition?: boolean | undefined;
  } = {},
): RunDag['jobs'][number] {
  const mode = options.mode ?? 'one_shot';
  return {
    id,
    key,
    mode,
    status: options.status ?? 'pending',
    ...(mode === 'listening' ? {} : {jobExecutionId: id, executionVersion: 1}),
    executionTimeoutMs: null,
    listeningTimeoutMs: null,
    maxExecutions: null,
    onResolve: null,
    hasActivationCondition: options.hasActivationCondition ?? false,
    dependencies: deps,
    runner: ['ubuntu22'],
    version: 1,
  };
}

export function makeDag(jobs: RunDag['jobs'], workflowRunId = 'run-1'): RunDag {
  return {
    workflowRunId,
    runAttemptId: `${workflowRunId}-attempt-1`,
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    runVersion: 1,
    runTimeoutMs: 30 * 24 * 60 * 60 * 1000,
    jobs,
  };
}

// ---------------------------------------------------------------------------
// Environment lifecycle
// ---------------------------------------------------------------------------

export let testEnv: TestWorkflowEnvironment;
export let worker: Worker;

let workerRunPromise: Promise<void> | undefined;

export async function setupEnv(): Promise<void> {
  testEnv = await TestWorkflowEnvironment.createLocal();

  worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: WORKFLOWS_PATH,
    activities: createMockActivities(),
  });

  // Run worker in background: it processes tasks until shutdown is called
  workerRunPromise = worker.run();
  workerRunPromise.catch(() => {
    // Suppress unhandled rejection on shutdown
  });
}

export async function teardownEnv(): Promise<void> {
  worker?.shutdown();
  await workerRunPromise;
  await testEnv?.teardown();
}

function createMockActivities() {
  return {
    loadRunAttemptDag: (runAttemptId: string): RunDag => {
      calls.push({name: 'loadRunAttemptDag', params: runAttemptId});
      return cfg.dag;
    },

    setRunAttemptStatus: (params: {runAttemptId: string; status: string; version: number}) => {
      calls.push({name: 'setRunAttemptStatus', params});
      const status =
        params.status === 'running' && cfg.initialRunStatus ? cfg.initialRunStatus : params.status;
      return {newVersion: nextVersion(), status};
    },

    setJobStatus: (params: {
      jobId: string;
      status: string;
      version: number;
      statusReason?: string | null;
    }) => {
      calls.push({name: 'setJobStatus', params});
      const status =
        params.status === 'running' && cfg.runningJobStatus ? cfg.runningJobStatus : params.status;
      return {newVersion: nextVersion(), status};
    },

    evaluateJobActivationsActivity: (params: {
      runAttemptId: string;
      jobs: readonly {jobId: string; expectedVersion: number}[];
    }): JobActivationDecision[] => {
      calls.push({name: 'evaluateJobActivationsActivity', params});
      return params.jobs.map((job) => {
        const decision = cfg.activationDecisions?.get(job.jobId);
        return decision ?? {kind: 'start-job', jobId: job.jobId};
      });
    },

    setJobExecutionStatus: async (params: {
      jobExecutionId: string;
      status: string;
      version: number;
      statusReason?: string | null;
    }) => {
      calls.push({name: 'setJobExecutionStatus', params});
      const status =
        params.status === 'running' && cfg.runningJobStatus ? cfg.runningJobStatus : params.status;

      if (params.status === 'running') {
        const outcome = pendingJobOutcomes.get(params.jobExecutionId);
        pendingJobOutcomes.delete(params.jobExecutionId);
        if (outcome && status === 'running') {
          await outcome.handle.signal(JOB_FINISHED_SIGNAL, {
            status: outcome.status,
            jobExecutionId: params.jobExecutionId,
          });
          if (outcome.duplicateSignal) {
            await outcome.handle.signal(JOB_FINISHED_SIGNAL, {
              status: 'failed',
              jobExecutionId: params.jobExecutionId,
            });
          }
        }
      }

      return {newVersion: nextVersion(), status};
    },

    bulkSetStepStatuses: (params: {jobExecutionId: string; status: string}) => {
      calls.push({name: 'bulkSetStepStatuses', params});
    },

    // Scheduling is step-less. The mock runner reports the job outcome by signalling
    // the per-step terminal-completion signal (job-finished) and/or the lease-expiry
    // signal, reproducing the outbox → subscriber → signal rail.
    queueJobExecutionActivity: async (params: {jobId: string; jobExecutionId: string}) => {
      calls.push({name: 'queueJobExecutionActivity', params});

      if (cfg.queueError) {
        const {ApplicationFailure} = await import('@temporalio/common');
        throw ApplicationFailure.nonRetryable(cfg.queueError);
      }

      const queued = {newVersion: nextVersion(), status: 'pending' as const};
      if (cfg.skipSignal) return queued;

      const status = cfg.jobResults.get(params.jobId) ?? 'succeeded';
      const handle = testEnv.client.workflow.getHandle(`job:${params.jobId}`);
      await handle.signal(JOB_CLAIMED_SIGNAL, {
        jobExecutionId: params.jobExecutionId,
        claimedAt: cfg.claimedAt ?? '2026-06-22T10:05:00.000Z',
      });

      if (cfg.skipOutcomeSignal) return queued;

      if (cfg.signalLeaseExpired) {
        await handle.signal(JOB_LEASE_EXPIRED_SIGNAL, {jobExecutionId: params.jobExecutionId});
        return queued;
      }

      if (cfg.signalBoth) {
        await handle.signal(JOB_FINISHED_SIGNAL, {status, jobExecutionId: params.jobExecutionId});
        await handle.signal(JOB_LEASE_EXPIRED_SIGNAL, {jobExecutionId: params.jobExecutionId});
        return queued;
      }

      // The terminal outbox is independent from the claim, but the mock delivers it from the
      // pending → running activity. This gives the workflow a deterministic ordering boundary
      // without leaving a polling promise alive after the test finishes.
      pendingJobOutcomes.set(params.jobExecutionId, {
        handle,
        status,
        duplicateSignal: cfg.duplicateSignal ?? false,
      });
      return queued;
    },

    resolveLeaseExpiredJobExecutionActivity: (params: {
      jobExecutionId: string;
      expectedVersion: number;
    }) => {
      calls.push({name: 'resolveLeaseExpiredJobExecutionActivity', params});
      return {status: cfg.leaseExpiredStatus ?? 'failed', executionVersion: nextVersion()};
    },

    resolveJobStatusFromJobExecutionsActivity: async (params: {jobId: string}) => {
      calls.push({name: 'resolveJobStatusFromJobExecutionsActivity', params});
      if (cfg.resolveJobStatusError) {
        const {ApplicationFailure} = await import('@temporalio/common');
        throw ApplicationFailure.nonRetryable(cfg.resolveJobStatusError);
      }
      const terminalExecutionStatus = [...setExecutionStatusCalls()]
        .reverse()
        .find(
          (call) => call.params.jobExecutionId === params.jobId && call.params.status !== 'running',
        )?.params.status as RuntimeCompletionStatus | undefined;
      return {
        status: cfg.leaseExpiredStatus ?? terminalExecutionStatus ?? 'succeeded',
        jobVersion: nextVersion(),
      };
    },

    failJobExecutionAsTimedOutActivity: async (params: {
      jobExecutionId: string;
      runAttemptId: string;
      expectedVersion: number;
    }) => {
      calls.push({name: 'failJobExecutionAsTimedOutActivity', params});
      if (cfg.failJobExecutionAsTimedOutError) {
        const {ApplicationFailure} = await import('@temporalio/common');
        throw ApplicationFailure.nonRetryable(cfg.failJobExecutionAsTimedOutError);
      }
      return {newVersion: nextVersion()};
    },

    activateJobListenerActivity: async (params: {jobId: string; expectedVersion: number}) => {
      calls.push({name: 'activateJobListenerActivity', params});
      if (cfg.listenerActivationError) {
        const {ApplicationFailure} = await import('@temporalio/common');
        throw ApplicationFailure.nonRetryable(
          cfg.listenerActivationError,
          'WorkflowExecutionPayloadTooLargeError',
        );
      }
      return (
        cfg.listenerActivated ?? {
          status: 'running',
          jobStatus: 'running',
          jobVersion: nextVersion(),
          executionCount: 0,
        }
      );
    },

    // Each call consumes the next scripted drain result. An exhausted script means
    // "no events buffered", which parks the listener until a signal or its deadline.
    drainListenerEventsActivity: (params: {
      jobId: string;
      expectedSequence: number;
      maxSize?: number;
    }) => {
      calls.push({name: 'drainListenerEventsActivity', params});
      return cfg.drainResults?.shift() ?? {kind: 'empty'};
    },

    peekListenerBufferActivity: (params: {jobId: string}) => {
      calls.push({name: 'peekListenerBufferActivity', params});
      return (
        cfg.peekResults?.shift() ?? {
          fireCount: 0,
          resolvePending: false,
          oldestAgeMs: 0,
          newestAgeMs: 0,
        }
      );
    },

    resolveJobListenerActivity: (params: {jobId: string; reason: string}) => {
      calls.push({name: 'resolveJobListenerActivity', params});
      return cfg.listenerResolved ?? {status: 'succeeded', jobVersion: nextVersion()};
    },

    settleListenerJobExecutionActivity: (params: {
      jobExecutionId: string;
      status: 'failed' | 'cancelled';
    }) => {
      calls.push({name: 'settleListenerJobExecutionActivity', params});
    },

    recordListenerFiringOutcomeActivity: (params: {
      outcome: 'succeeded' | 'failed' | 'cancelled';
    }) => {
      calls.push({name: 'recordListenerFiringOutcomeActivity', params});
    },
  };
}
