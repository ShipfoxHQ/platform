import type {
  InferenceSegmentUsageHttpDto,
  JobExecutionUsageHttpDto,
  JobExecutionUsageResponseDto,
  RunUsageResponseDto,
} from '@shipfox/api-usage-dto';
import type {
  JobExecutionUsage,
  RunUsage,
  UsageInferenceSegment,
  UsageJobExecution,
} from '#core/usage.js';

export function toUsageJobExecution(dto: JobExecutionUsageHttpDto): UsageJobExecution {
  return {
    jobId: dto.job_id,
    jobExecutionId: dto.job_execution_id,
    workflowRunId: dto.workflow_run_id,
    workflowRunAttemptId: dto.workflow_run_attempt_id,
    workspaceId: dto.workspace_id,
    projectId: dto.project_id,
    definitionId: dto.definition_id,
    jobKey: dto.job_key,
    runNumber: dto.run_number,
    requestedLabels: dto.requested_labels,
    runnerLabels: dto.runner_labels,
    templateKey: dto.template_key,
    provisionerId: dto.provisioner_id,
    provisionerScope: dto.provisioner_scope,
    providerKind: dto.provider_kind,
    launchKind: dto.launch_kind,
    runnerClass: dto.runner_class,
    runnerArch: dto.runner_arch,
    runnerCpu: dto.runner_cpu,
    managed: dto.managed,
    queuedAt: dto.queued_at,
    startedAt: dto.started_at,
    finishedAt: dto.finished_at,
    leaseExpiredAt: dto.lease_expired_at,
    status: dto.status,
    statusReason: dto.status_reason,
    cancellationReason: dto.cancellation_reason,
    durationSeconds: dto.duration_seconds,
    state: dto.state,
    recordedAt: dto.recorded_at,
  };
}

export function toUsageInferenceSegment(dto: InferenceSegmentUsageHttpDto): UsageInferenceSegment {
  return {
    id: dto.id,
    segmentKey: dto.segment_key,
    source: dto.source,
    workspaceId: dto.workspace_id,
    projectId: dto.project_id,
    workflowRunId: dto.workflow_run_id,
    workflowRunAttemptId: dto.workflow_run_attempt_id,
    jobId: dto.job_id,
    jobExecutionId: dto.job_execution_id,
    stepId: dto.step_id,
    stepAttemptId: dto.step_attempt_id,
    upstream: dto.upstream,
    model: dto.model,
    dialect: dto.dialect,
    windowStart: dto.window_start,
    windowEnd: dto.window_end,
    requestCount: dto.request_count,
    inputTokens: dto.input_tokens,
    outputTokens: dto.output_tokens,
    cacheCreationTokens: dto.cache_creation_tokens,
    cacheReadTokens: dto.cache_read_tokens,
    reasoningTokens: dto.reasoning_tokens,
    recordedAt: dto.recorded_at,
  };
}

export function toRunUsage(dto: RunUsageResponseDto): RunUsage {
  return {
    jobExecutions: dto.job_executions.map(toUsageJobExecution),
    inferenceSegments: dto.inference_segments.map(toUsageInferenceSegment),
  };
}

export function toJobExecutionUsage(dto: JobExecutionUsageResponseDto): JobExecutionUsage {
  return {
    jobExecution: toUsageJobExecution(dto.job_execution),
    inferenceSegments: dto.inference_segments.map(toUsageInferenceSegment),
  };
}
