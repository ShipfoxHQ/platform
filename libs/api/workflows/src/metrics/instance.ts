import {
  WORKFLOW_RUN_DETAIL_REQUEST_KINDS,
  type WorkflowRunDetailRequestKind,
} from '@shipfox/api-workflows-dto';
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

const checkoutTokenRequestsCount = meter.createCounter<{
  mode: 'initial' | 'renewal';
  outcome: 'success' | 'failure';
}>('workflows_checkout_token_requests', {
  description: 'Checkout credential requests by delivery mode and outcome',
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

const toolInvocationDuration = meter.createHistogram<{
  provider: string;
  outcome: 'success' | 'error';
}>('workflows_tool_invocation_duration_ms', {
  description: 'Server-executed workflow tool invocation duration by provider and outcome',
  unit: 'ms',
  advice: {explicitBucketBoundaries: [10, 50, 100, 500, 1_000, 5_000, 30_000, 120_000]},
});

const toolInvocationReclaimsCount = meter.createCounter<{
  action: 'requeued' | 'failed';
}>('workflows_tool_invocation_reclaims', {
  description: 'Expired server-executed workflow tool invocations reclaimed by the executor',
});

const toolInvocationLogAppendFailuresCount = meter.createCounter<{
  reason: 'known' | 'unexpected';
}>('workflows_tool_invocation_log_append_failures', {
  description: 'Server-executed workflow tool invocation log append failures by error class',
});

export type WorkflowRunDetailReadOutcome = 'success' | 'not_found' | 'error';
export type WorkflowRunDetailRequestKindMetric = WorkflowRunDetailRequestKind | 'unknown';

type WorkflowRunDetailMetricLabels = {
  request_kind: WorkflowRunDetailRequestKindMetric;
  outcome: WorkflowRunDetailReadOutcome;
};

const workflowRunDetailReadCount = meter.createCounter<WorkflowRunDetailMetricLabels>(
  'workflows_run_detail_reads',
  {
    description: 'Legacy workflow-run detail reads by bounded request kind and outcome',
  },
);

const workflowRunDetailDuration = meter.createHistogram<WorkflowRunDetailMetricLabels>(
  'workflows_run_detail_duration',
  {
    description: 'Legacy workflow-run detail handler duration',
    unit: 'ms',
    advice: {explicitBucketBoundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000]},
  },
);

const workflowRunDetailDatabaseDuration = meter.createHistogram<WorkflowRunDetailMetricLabels>(
  'workflows_run_detail_database_duration',
  {
    description: 'Legacy workflow-run detail database read duration',
    unit: 'ms',
    advice: {explicitBucketBoundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000]},
  },
);

const workflowRunDetailResponseBytes = meter.createHistogram<WorkflowRunDetailMetricLabels>(
  'workflows_run_detail_response_size',
  {
    description: 'Serialized legacy workflow-run detail response size',
    unit: 'By',
    advice: {
      explicitBucketBoundaries: [1_024, 10_240, 50_000, 100_000, 200_000, 500_000, 1_000_000],
    },
  },
);

const workflowRunDetailReturnedRows = meter.createHistogram<WorkflowRunDetailMetricLabels>(
  'workflows_run_detail_returned_rows',
  {
    description: 'Rows materialized by the legacy workflow-run detail join',
    unit: '1',
    advice: {explicitBucketBoundaries: [1, 10, 100, 1_000, 10_000, 100_000]},
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

export function recordWorkflowCheckoutTokenRequest(
  mode: 'initial' | 'renewal',
  outcome: 'success' | 'failure',
): void {
  checkoutTokenRequestsCount.add(1, {mode, outcome});
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

export function recordWorkflowToolInvocationDuration(
  provider: string,
  outcome: 'success' | 'error',
  durationMs: number,
): void {
  toolInvocationDuration.record(durationMs, {provider, outcome});
}

export function recordWorkflowToolInvocationReclaims(
  action: 'requeued' | 'failed',
  count: number,
): void {
  if (count > 0) toolInvocationReclaimsCount.add(count, {action});
}

export function recordWorkflowToolInvocationLogAppendFailure(reason: 'known' | 'unexpected'): void {
  toolInvocationLogAppendFailuresCount.add(1, {reason});
}

export function recordWorkflowAgentToolWarningFailed(reason: 'budget' | 'lookup' | 'write'): void {
  agentToolWarningFailedCount.add(1, {reason});
}

export function recordWorkflowFailureAnnotationFailed(reason: 'lookup' | 'budget' | 'write'): void {
  failureAnnotationFailedCount.add(1, {reason});
}

export interface WorkflowRunDetailReadObservation {
  durationMilliseconds: number;
  databaseDurationMilliseconds: number;
  responseBytes: number;
  returnedRows: number;
  requestKind: WorkflowRunDetailRequestKindMetric;
  outcome: WorkflowRunDetailReadOutcome;
}

export function recordWorkflowRunDetailRead(observation: WorkflowRunDetailReadObservation): void {
  if (
    observation.durationMilliseconds < 0 ||
    observation.databaseDurationMilliseconds < 0 ||
    observation.responseBytes < 0 ||
    observation.returnedRows < 0
  ) {
    return;
  }

  recordMetric(() => {
    const labels = {
      request_kind: observation.requestKind,
      outcome: observation.outcome,
    } satisfies WorkflowRunDetailMetricLabels;
    workflowRunDetailReadCount.add(1, labels);
    workflowRunDetailDuration.record(observation.durationMilliseconds, labels);
    workflowRunDetailDatabaseDuration.record(observation.databaseDurationMilliseconds, labels);
    workflowRunDetailResponseBytes.record(observation.responseBytes, labels);
    workflowRunDetailReturnedRows.record(observation.returnedRows, labels);
  });
}

export function classifyWorkflowRunDetailRequestKind(
  value: string | string[] | undefined,
): WorkflowRunDetailRequestKindMetric {
  if (typeof value !== 'string') return 'unknown';
  return (WORKFLOW_RUN_DETAIL_REQUEST_KINDS as readonly string[]).includes(value)
    ? (value as WorkflowRunDetailRequestKind)
    : 'unknown';
}

function recordMetric(record: () => void): void {
  try {
    record();
  } catch {
    // Measurement must never change a workflow-read outcome.
  }
}
