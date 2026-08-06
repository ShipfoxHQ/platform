import {instanceMetrics} from '@shipfox/node-opentelemetry';
import type {JobStatus, ResolutionReason} from '#core/entities/job.js';
import type {JobExecutionStatus} from '#core/entities/job-execution.js';
import type {WorkflowRunStatus} from '#core/entities/workflow-run.js';
import type {RuntimeCompletionStatus} from '#core/workflow-scheduling/runtime-dag.js';

const meter = instanceMetrics.getMeter('workflows');

const runCreatedCount = meter.createCounter<{provider: string}>('workflows_run_created', {
  description: 'Workflow runs created by bounded trigger provider',
});

const displayNameResolutionDegradedCount = meter.createCounter<{
  field: 'workflow.run_name' | 'job.execution_name';
  cause: 'missing_value' | 'evaluation_error' | 'empty_value' | 'sanitization';
}>('workflows_display_name_resolution_degraded', {
  description: 'Display-name resolution degradations by field and bounded cause',
});

const runStatusChangedCount = meter.createCounter<{status: WorkflowRunStatus}>(
  'workflows_run_status_changed',
  {description: 'Workflow run status transitions by resulting status'},
);

const jobStatusChangedCount = meter.createCounter<{status: JobStatus}>(
  'workflows_job_status_changed',
  {description: 'Workflow job status transitions by resulting status'},
);

const jobExecutionStatusChangedCount = meter.createCounter<{status: JobExecutionStatus}>(
  'workflows_job_execution_status_changed',
  {description: 'Workflow job execution status transitions by resulting status'},
);

const jobExecutionQueuedCount = meter.createCounter<Record<string, never>>(
  'workflows_job_execution_queued',
  {
    description: 'Workflow job executions first marked as queued from runner queue events',
  },
);

const jobExecutionStartedCount = meter.createCounter<Record<string, never>>(
  'workflows_job_execution_started',
  {
    description: 'Workflow job executions first marked as started from runner claim events',
  },
);

const jobExecutionStepsSettledCount = meter.createCounter<{
  status: Extract<RuntimeCompletionStatus, 'failed' | 'succeeded'>;
}>('workflows_job_execution_steps_settled', {
  description: 'Job execution steps-settled events enqueued by resulting completion status',
});

const jobExecutionTimedOutCount = meter.createCounter<Record<string, never>>(
  'workflows_job_execution_timed_out',
  {
    description: 'Workflow job executions failed by the execution orchestration timeout path',
  },
);

const jobExecutionLeaseExpiryResolvedCount = meter.createCounter<{status: RuntimeCompletionStatus}>(
  'workflows_job_execution_lease_expiry_resolved',
  {description: 'Runner lease-expiry resolutions by resulting runtime status'},
);

const stepRestartEnqueuedCount = meter.createCounter<Record<string, never>>(
  'workflows_step_restart_enqueued',
  {description: 'Durable step restart events enqueued after a restartable gate failure'},
);

const listenerEventsReceivedCount = meter.createCounter<{provider: string}>(
  'workflows_listener_events_received',
  {description: 'Listener integration events buffered by bounded trigger provider'},
);

const listenerExecutionsCount = meter.createCounter<{
  outcome: 'succeeded' | 'failed' | 'cancelled';
}>('workflows_listener_executions', {
  description: 'Listener job execution firings by terminal outcome',
});

const listenerResolvedCount = meter.createCounter<{reason: ResolutionReason}>(
  'workflows_listener_resolved',
  {description: 'Listener resolutions by bounded reason'},
);

const agentToolWarningFailedCount = meter.createCounter<{
  reason: 'budget' | 'lookup' | 'write';
}>('workflows_agent_tool_warning_failed', {
  description: 'Agent tool capability warning failures by bounded reason',
});

const failureAnnotationFailedCount = meter.createCounter<{
  reason: 'lookup' | 'budget' | 'write';
}>('workflows_failure_annotation_failed', {
  description: 'Failure annotation projection failures by bounded reason',
});

const listenerEventsCoalesced = meter.createHistogram<Record<string, never>>(
  'workflows_listener_events_coalesced',
  {
    description: 'Listener firing batch sizes',
    unit: '1',
    advice: {explicitBucketBoundaries: [1, 2, 5, 10, 25, 50, 100, 250]},
  },
);

export function recordWorkflowRunCreated(provider: string): void {
  runCreatedCount.add(1, {provider});
}

export function recordWorkflowDisplayNameResolutionDegraded(
  field: 'workflow.run_name' | 'job.execution_name',
  cause: 'missing_value' | 'evaluation_error' | 'empty_value' | 'sanitization',
): void {
  displayNameResolutionDegradedCount.add(1, {field, cause});
}

export function recordWorkflowRunStatusChanged(status: WorkflowRunStatus): void {
  runStatusChangedCount.add(1, {status});
}

export function recordWorkflowJobStatusChanged(status: JobStatus): void {
  jobStatusChangedCount.add(1, {status});
}

export function recordWorkflowJobExecutionStatusChanged(status: JobExecutionStatus): void {
  jobExecutionStatusChangedCount.add(1, {status});
}

export function recordWorkflowJobExecutionQueued(): void {
  jobExecutionQueuedCount.add(1);
}

export function recordWorkflowJobExecutionStarted(): void {
  jobExecutionStartedCount.add(1);
}

export function recordWorkflowJobExecutionStepsSettled(
  status: Extract<RuntimeCompletionStatus, 'failed' | 'succeeded'>,
): void {
  jobExecutionStepsSettledCount.add(1, {status});
}

export function recordWorkflowJobExecutionTimedOut(): void {
  jobExecutionTimedOutCount.add(1);
}

export function recordWorkflowJobExecutionLeaseExpiryResolved(
  status: RuntimeCompletionStatus,
): void {
  jobExecutionLeaseExpiryResolvedCount.add(1, {status});
}

export function recordWorkflowStepRestartEnqueued(): void {
  stepRestartEnqueuedCount.add(1);
}

export function recordListenerEventReceived(provider: string): void {
  listenerEventsReceivedCount.add(1, {provider});
}

export function recordWorkflowListenerExecution(
  outcome: 'succeeded' | 'failed' | 'cancelled',
): void {
  listenerExecutionsCount.add(1, {outcome});
}

export function recordWorkflowListenerResolved(reason: ResolutionReason): void {
  listenerResolvedCount.add(1, {reason});
}

export function recordListenerEventsCoalesced(batchSize: number): void {
  listenerEventsCoalesced.record(batchSize);
}

export function recordWorkflowAgentToolWarningFailed(reason: 'budget' | 'lookup' | 'write'): void {
  agentToolWarningFailedCount.add(1, {reason});
}

export function recordWorkflowFailureAnnotationFailed(reason: 'lookup' | 'budget' | 'write'): void {
  failureAnnotationFailedCount.add(1, {reason});
}
