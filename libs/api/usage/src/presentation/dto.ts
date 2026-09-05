import type {InferenceSegmentUsageHttpDto, JobExecutionUsageHttpDto} from '@shipfox/api-usage-dto';
import type {UsageInferenceSegmentRow} from '#db/inference-segments.js';
import type {UsageJobExecutionRow} from '#db/job-executions.js';

export function toJobExecutionUsageDto(row: UsageJobExecutionRow): JobExecutionUsageHttpDto {
  if (!row.workspaceId || !row.projectId) {
    throw new Error(`Cannot expose workspace-less Usage row ${row.jobExecutionId}`);
  }
  return {
    job_id: row.jobId,
    job_execution_id: row.jobExecutionId,
    workflow_run_id: row.workflowRunId,
    workflow_run_attempt_id: row.workflowRunAttemptId,
    workspace_id: row.workspaceId,
    project_id: row.projectId,
    definition_id: row.definitionId,
    job_key: row.jobKey,
    run_number: row.runNumber,
    requested_labels: row.requestedLabels,
    runner_labels: row.runnerLabels,
    template_key: row.templateKey,
    provisioner_id: row.provisionerId,
    provisioner_scope: row.provisionerScope,
    provider_kind: row.providerKind,
    launch_kind: row.launchKind,
    runner_class: row.runnerClass,
    runner_arch: row.runnerArch,
    runner_cpu: row.runnerCpu,
    managed: row.managed,
    queued_at: iso(row.queuedAt),
    started_at: iso(row.startedAt),
    finished_at: iso(row.finishedAt),
    lease_expired_at: iso(row.leaseExpiredAt),
    status: row.status,
    status_reason: row.statusReason,
    cancellation_reason: row.cancellationReason,
    duration_seconds: row.durationSeconds,
    state: row.state,
    recorded_at: iso(row.recordedAt),
  };
}

export function toInferenceSegmentUsageDto(
  row: UsageInferenceSegmentRow,
): InferenceSegmentUsageHttpDto {
  return {
    id: row.id,
    segment_key: row.segmentKey,
    source: row.source,
    workspace_id: row.workspaceId,
    project_id: row.projectId,
    workflow_run_id: row.workflowRunId,
    workflow_run_attempt_id: row.workflowRunAttemptId,
    job_id: row.jobId,
    job_execution_id: row.jobExecutionId,
    step_id: row.stepId,
    step_attempt_id: row.stepAttemptId,
    upstream: row.upstream,
    model: row.model,
    dialect: row.dialect,
    window_start: row.windowStart.toISOString(),
    window_end: row.windowEnd.toISOString(),
    request_count: row.requestCount,
    input_tokens: row.inputTokens,
    output_tokens: row.outputTokens,
    cache_creation_tokens: row.cacheCreationTokens,
    cache_read_tokens: row.cacheReadTokens,
    reasoning_tokens: row.reasoningTokens,
    web_search_requests: row.webSearchRequests,
    recorded_at: row.recordedAt.toISOString(),
  };
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}
