import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import {ApplicationFailure} from '@temporalio/common';
import {defaultJobConditionTrace} from '#core/condition-trace.js';
import type {JobStatus, JobStatusReason, ResolutionReason} from '#core/entities/job.js';
import type {PersistedEvaluationTraceEntry, StepStatus} from '#core/entities/step.js';
import type {WorkflowRunStatus} from '#core/entities/workflow-run.js';
import {JobNotFoundError, WorkflowExecutionPayloadTooLargeError} from '#core/errors.js';
import type {
  RuntimeCompletionStatus,
  RuntimeDagNode,
} from '#core/workflow-scheduling/runtime-dag.js';
import {
  activateJobListener,
  bulkUpdateStepStatuses,
  drainListenerEventsIntoExecution,
  type EvaluateJobActivationsParams,
  evaluateJobActivations,
  failJobExecutionAsTimedOut,
  failWorkflowRunAsTimedOut,
  getJobExecutionsByWorkflowRunAttemptId,
  getJobsByWorkflowRunAttemptId,
  getWorkflowRunAttemptById,
  getWorkflowRunByAttemptId,
  type JobActivationDecision,
  peekListenerBuffer,
  queueJobExecution,
  resolveJobExecutionAfterLeaseExpiry,
  resolveJobListener,
  resolveJobStatusFromJobExecutions,
  settleListenerJobExecution,
  updateJobExecutionStatus,
  updateJobStatus,
  updateWorkflowRunStatus,
} from '#db/index.js';
import {recordWorkflowListenerExecution} from '#metrics/instance.js';

export interface DagJob extends RuntimeDagNode {
  id: string;
  key: string;
  mode: 'one_shot' | 'listening';
  status: JobStatus;
  jobExecutionId?: string | undefined;
  executionVersion?: number;
  executionTimeoutMs?: number | null | undefined;
  listeningTimeoutMs?: number | null | undefined;
  maxExecutions?: number | null | undefined;
  onResolve?: 'finish' | 'cancel' | null | undefined;
  batchDebounceMs?: number | null | undefined;
  batchMaxSize?: number | null | undefined;
  batchMaxWaitMs?: number | null | undefined;
  dependencies: string[];
  runner: string[];
  version: number;
}

export interface RunDag {
  workflowRunId: string;
  runAttemptId: string;
  workspaceId: string;
  projectId: string;
  runVersion: number;
  runTimeoutMs: number;
  jobs: DagJob[];
}

export async function loadRunAttemptDag(runAttemptId: string): Promise<RunDag> {
  const run = await getWorkflowRunByAttemptId(runAttemptId);
  if (!run) throw new Error(`Run not found for attempt: ${runAttemptId}`);
  const attempt = await getWorkflowRunAttemptById(runAttemptId);
  if (!attempt) throw new Error(`Run attempt not found: ${runAttemptId}`);

  const jobs = await getJobsByWorkflowRunAttemptId(runAttemptId);
  const jobExecutions = await getJobExecutionsByWorkflowRunAttemptId(runAttemptId);
  const firstJobExecutions = new Map<string, (typeof jobExecutions)[number]>();
  for (const jobExecution of jobExecutions) {
    if (!firstJobExecutions.has(jobExecution.jobId)) {
      firstJobExecutions.set(jobExecution.jobId, jobExecution);
    }
  }

  return {
    workflowRunId: run.id,
    runAttemptId,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    runVersion: attempt.version,
    runTimeoutMs: run.timeoutMs,
    jobs: jobs.flatMap((job) => {
      const jobExecution = firstJobExecutions.get(job.id);
      const modelJob = attempt.model?.jobs.find((item) => item.key === job.key);
      if (!jobExecution && job.mode !== 'listening') return [];
      return [
        {
          id: job.id,
          key: job.key,
          mode: job.mode,
          status: job.status,
          ...(jobExecution === undefined
            ? {}
            : {jobExecutionId: jobExecution.id, executionVersion: jobExecution.version}),
          executionTimeoutMs: job.executionTimeoutMs,
          listeningTimeoutMs: job.listeningTimeoutMs,
          maxExecutions: job.maxExecutions,
          onResolve: job.onResolve,
          batchDebounceMs: job.batchDebounceMs,
          batchMaxSize: job.batchMaxSize,
          batchMaxWaitMs: job.batchMaxWaitMs,
          dependencies: job.dependencies,
          hasActivationCondition: modelJob?.if !== undefined,
          runner: jobExecution?.runner ?? job.runner ?? [],
          version: job.version,
        },
      ];
    }),
  };
}

export async function evaluateJobActivationsActivity(
  params: EvaluateJobActivationsParams,
): Promise<JobActivationDecision[]> {
  return await evaluateJobActivations(params);
}

export async function setRunAttemptStatus(params: {
  runAttemptId: string;
  status: WorkflowRunStatus;
  version: number;
}): Promise<{newVersion: number; status: WorkflowRunStatus}> {
  const updated = await updateWorkflowRunStatus({
    workflowRunAttemptId: params.runAttemptId,
    status: params.status,
    expectedVersion: params.version,
  });
  return {newVersion: updated.version, status: updated.status};
}

export async function setJobStatus(params: {
  jobId: string;
  status: JobStatus;
  version: number;
  statusReason?: JobStatusReason | null | undefined;
  evaluationTrace?: readonly PersistedEvaluationTraceEntry[] | null | undefined;
}): Promise<{newVersion: number; status: JobStatus}> {
  const updated = await updateJobStatus({
    jobId: params.jobId,
    status: params.status,
    expectedVersion: params.version,
    statusReason: params.statusReason,
    evaluationTrace: jobStatusEvaluationTrace(params),
  });
  return {newVersion: updated.version, status: updated.status};
}

function jobStatusEvaluationTrace(params: {
  status: JobStatus;
  statusReason?: JobStatusReason | null | undefined;
  evaluationTrace?: readonly PersistedEvaluationTraceEntry[] | null | undefined;
}): readonly PersistedEvaluationTraceEntry[] | null | undefined {
  if (params.evaluationTrace !== undefined) return params.evaluationTrace;
  return params.status === 'skipped' && params.statusReason === 'default_gate_rejected'
    ? defaultJobConditionTrace()
    : undefined;
}

export async function setJobExecutionStatus(
  params: {
    jobExecutionId: string;
    status: Exclude<JobStatus, 'skipped'>;
    version: number;
    statusReason?: JobStatusReason | null | undefined;
  },
  secrets?: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'>,
): Promise<{newVersion: number; status: Exclude<JobStatus, 'skipped'>}> {
  const updated = await updateJobExecutionStatus({
    jobExecutionId: params.jobExecutionId,
    status: params.status,
    expectedVersion: params.version,
    statusReason: params.statusReason,
    secrets,
  });
  return {newVersion: updated.version, status: updated.status};
}

export async function bulkSetStepStatuses(params: {
  jobExecutionId: string;
  status: Extract<StepStatus, 'failed' | 'cancelled'>;
}): Promise<void> {
  await bulkUpdateStepStatuses(params);
}

export async function resolveLeaseExpiredJobExecutionActivity(
  params: {jobExecutionId: string; expectedVersion: number},
  secrets: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'>,
): Promise<{status: RuntimeCompletionStatus; executionVersion: number}> {
  try {
    return await resolveJobExecutionAfterLeaseExpiry({...params, secrets});
  } catch (err) {
    if (err instanceof JobNotFoundError) {
      throw ApplicationFailure.nonRetryable(err.message, err.name);
    }
    throw err;
  }
}

export async function queueJobExecutionActivity(params: {
  jobId: string;
  jobExecutionId: string;
}): Promise<{newVersion: number; status: Exclude<JobStatus, 'skipped'>}> {
  try {
    const execution = await queueJobExecution({jobExecutionId: params.jobExecutionId});
    return {newVersion: execution.version, status: execution.status};
  } catch (err) {
    if (err instanceof JobNotFoundError) {
      throw ApplicationFailure.nonRetryable(err.message, err.name);
    }
    throw err;
  }
}

export async function failJobExecutionAsTimedOutActivity(
  params: {jobExecutionId: string; runAttemptId: string; expectedVersion: number},
  secrets: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'>,
): Promise<{newVersion: number}> {
  const jobExecution = await failJobExecutionAsTimedOut({
    jobExecutionId: params.jobExecutionId,
    workflowRunAttemptId: params.runAttemptId,
    expectedVersion: params.expectedVersion,
    secrets,
  });
  return {newVersion: jobExecution.version};
}

export async function failRunAsTimedOutActivity(params: {runAttemptId: string}): Promise<void> {
  await failWorkflowRunAsTimedOut({runAttemptId: params.runAttemptId});
}

export async function resolveJobStatusFromJobExecutionsActivity(params: {
  jobId: string;
}): Promise<{status: RuntimeCompletionStatus; jobVersion: number}> {
  return await resolveJobStatusFromJobExecutions(params);
}

export async function activateJobListenerActivity(params: {
  jobId: string;
  expectedVersion: number;
}) {
  try {
    return await activateJobListener(params);
  } catch (error) {
    if (error instanceof WorkflowExecutionPayloadTooLargeError) {
      throw ApplicationFailure.nonRetryable(error.message, error.name);
    }
    throw error;
  }
}

export function createDrainListenerEventsActivity(clients: {
  agent: AgentInterModuleClient;
  integrations?: IntegrationsModuleClient | undefined;
  projects?: ProjectsModuleClient | undefined;
  secrets: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'>;
}) {
  return async function drainListenerEventsActivity(params: {
    jobId: string;
    expectedSequence: number;
    maxSize?: number | undefined;
  }) {
    return await drainListenerEventsIntoExecution({...params, ...clients});
  };
}

export async function peekListenerBufferActivity(params: {jobId: string}) {
  return await peekListenerBuffer(params);
}

export async function resolveJobListenerActivity(params: {
  jobId: string;
  reason: ResolutionReason;
}) {
  return await resolveJobListener(params);
}

export async function settleListenerJobExecutionActivity(params: {
  jobExecutionId: string;
  status: 'failed' | 'cancelled';
}) {
  await settleListenerJobExecution(params);
}

// The listener workflow owns every firing's terminal outcome, but a workflow
// sandbox cannot emit metrics. This activity is the single recording point so
// each firing is counted exactly once, including successes that settle through
// the child's own resolution path rather than a listener DB write. The body is
// synchronous; it returns a resolved promise because Temporal invokes activities
// asynchronously.
export function recordListenerFiringOutcomeActivity(params: {
  outcome: 'succeeded' | 'failed' | 'cancelled';
}): Promise<void> {
  recordWorkflowListenerExecution(params.outcome);
  return Promise.resolve();
}
