import type {
  EvaluationTraceDto,
  JobExecutionSummaryDto,
  JobListeningDto,
  JobModeDto,
  JobStatusDto,
  JobStatusReasonDto,
  ListenerStatusDto,
  ResolutionReasonDto,
  StepAttemptDto,
  StepDto,
  StepErrorDto,
  StepGateResultDto,
  StepGateResultSummaryDto,
  WorkflowExecutionEventDto,
} from '@shipfox/api-workflows-dto';
import {
  type EvaluationTraceEntry,
  Job,
  JobExecution,
  type JobListening,
  type Step,
  StepAttempt,
  type StepError,
  type StepGateResult,
  type WorkflowExecutionEvent,
} from '#core/workflow-run.js';

export function toWorkflowJobStepError(dto: StepErrorDto): StepError | null {
  if (dto === null) return null;
  return {
    message: dto.message,
    ...(dto.code === undefined ? {} : {code: dto.code}),
    ...(dto.managed_provider_id === undefined ? {} : {managedProviderId: dto.managed_provider_id}),
    ...(dto.field === undefined ? {} : {field: dto.field}),
    ...(dto.source === undefined ? {} : {source: dto.source}),
    exitCode: dto.exit_code ?? null,
    signal: dto.signal,
    reason: dto.reason,
    agentConfigIssue: dto.agent_config_issue,
    category: dto.category,
  };
}

export function toWorkflowJobGateResult(dto: StepGateResultSummaryDto): StepGateResult {
  if (dto === null) return null;
  if (dto.kind === 'unknown') return {kind: 'unknown', data: {}};
  if (dto.kind === 'none' || dto.kind === 'not_evaluated') return {kind: dto.kind};
  if (dto.kind === 'passed' && 'source' in dto) {
    return {kind: 'passed', passed: true, source: dto.source, exitCode: dto.exit_code};
  }
  if (dto.kind === 'failed' && 'source' in dto) {
    return {kind: 'failed', passed: false, source: dto.source, exitCode: dto.exit_code};
  }
  if (dto.kind === 'uncheckable' && 'uncheckable' in dto) {
    return {
      kind: 'uncheckable',
      passed: false,
      uncheckable: true,
      reason: dto.reason,
      exitCode: dto.exit_code,
    };
  }
  if (dto.kind === 'evaluation_error' && 'reason' in dto) {
    return {kind: 'evaluation_error', reason: dto.reason, exitCode: dto.exit_code};
  }
  return {kind: 'unknown', data: {}};
}

export function toStepAttemptInvocation(invocation: StepAttemptDto['invocations'][number]) {
  return {
    callIndex: invocation.call_index,
    startedAt: invocation.started_at,
    ...(invocation.finished_at === undefined ? {} : {finishedAt: invocation.finished_at}),
    ...(invocation.outcome === undefined ? {} : {outcome: invocation.outcome}),
    ...(invocation.error_code === undefined ? {} : {errorCode: invocation.error_code}),
    ...(invocation.duration_ms === undefined ? {} : {durationMs: invocation.duration_ms}),
    ...(invocation.next_due_at === undefined ? {} : {nextDueAt: invocation.next_due_at}),
  };
}

export function toWorkflowExecutionEvent(dto: WorkflowExecutionEventDto): WorkflowExecutionEvent {
  return {
    source: dto.source,
    event: dto.event,
    deliveryId: dto.delivery_id,
    receivedAt: dto.received_at,
    project: dto.project,
    repository: dto.repository,
    ref: dto.ref,
    commit: dto.commit,
    data: dto.data,
  };
}

export function toStepGateResult(dto: StepGateResultDto): StepGateResult {
  if (dto === null || dto.kind === 'none' || dto.kind === 'not_evaluated') return dto;
  if (dto.kind === 'passed' || dto.kind === 'failed') return {...dto, exitCode: dto.exit_code};
  if (dto.kind === 'uncheckable' || dto.kind === 'evaluation_error')
    return {...dto, exitCode: dto.exit_code};
  return dto;
}

export function toEvaluationTrace(trace: EvaluationTraceDto | null): EvaluationTraceEntry[] | null {
  return trace?.map(toEvaluationTraceEntry) ?? null;
}

function toEvaluationTraceEntry(entry: EvaluationTraceDto[number]): EvaluationTraceEntry {
  if ('dropped' in entry) return entry;
  return {
    expression: entry.expression,
    roots: entry.roots,
    fillTarget: entry.fill_target,
    evaluatedAt: entry.evaluated_at,
    field: entry.field,
    ...(entry.value === undefined ? {} : {value: entry.value}),
    ...(entry.truncated === undefined ? {} : {truncated: entry.truncated}),
    ...(entry.expr_truncated === undefined ? {} : {exprTruncated: entry.expr_truncated}),
    ...(entry.reference === undefined ? {} : {reference: entry.reference}),
    ...(entry.degraded === undefined ? {} : {degraded: entry.degraded}),
    ...(entry.env_key === undefined ? {} : {envKey: entry.env_key}),
  };
}

export function recordConfigValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export type WorkflowStepModelDto = StepDto & {
  exit_code: number | null;
  outputs: Record<string, unknown> | null;
  response: string | null;
  gate_result: StepAttemptDto['gate_result'];
  attempts: StepAttemptDto[];
};

export type WorkflowJobExecutionModelDto = {
  id: string;
  job_id: string;
  sequence: number;
  name: string;
  status: JobExecutionSummaryDto['status'];
  status_reason: JobExecutionSummaryDto['status_reason'];
  status_reason_message: string | null;
  runner: string[] | null;
  trigger_events: WorkflowExecutionEventDto[];
  outputs: Record<string, unknown> | null;
  evaluation_trace: EvaluationTraceDto | null;
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  timed_out_at: string | null;
  created_at: string;
  updated_at: string;
  steps: WorkflowStepModelDto[];
};

export type WorkflowJobModelDto = {
  id: string;
  run_attempt_id: string;
  key: string;
  name: string | null;
  mode: JobModeDto;
  status: JobStatusDto;
  status_reason: JobStatusReasonDto | null;
  carried_over: boolean;
  success: string | null;
  runner: string[] | null;
  evaluation_trace: EvaluationTraceDto | null;
  listening: JobListeningDto | null;
  listener_status: ListenerStatusDto;
  resolution_reason: ResolutionReasonDto | null;
  outputs: Record<string, unknown> | null;
  dependencies: string[];
  position: number;
  created_at: string;
  updated_at: string;
  job_executions: WorkflowJobExecutionModelDto[];
};

export function toWorkflowJobModel(dto: WorkflowJobModelDto): Job {
  return new Job({
    id: dto.id,
    runAttemptId: dto.run_attempt_id,
    key: dto.key,
    name: dto.name,
    mode: dto.mode,
    status: dto.status,
    statusReason: dto.status_reason,
    carriedOver: dto.carried_over,
    outputs: dto.outputs,
    success: dto.success,
    runner: dto.runner,
    evaluationTrace: toEvaluationTrace(dto.evaluation_trace),
    listening: dto.listening ? toWorkflowJobListening(dto.listening) : null,
    listenerStatus: dto.listener_status,
    resolutionReason: dto.resolution_reason,
    dependencies: dto.dependencies,
    position: dto.position,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    jobExecutions: dto.job_executions.map(toWorkflowJobExecutionModel),
  });
}

export function toWorkflowJobExecutionModel(dto: WorkflowJobExecutionModelDto): JobExecution {
  return new JobExecution({
    id: dto.id,
    jobId: dto.job_id,
    sequence: dto.sequence,
    name: dto.name,
    status: dto.status,
    statusReason: dto.status_reason,
    statusReasonMessage: dto.status_reason_message,
    runner: dto.runner,
    outputs: dto.outputs,
    triggerEvents: dto.trigger_events.map(toWorkflowExecutionEvent),
    queuedAt: dto.queued_at,
    startedAt: dto.started_at,
    finishedAt: dto.finished_at,
    timedOutAt: dto.timed_out_at,
    evaluationTrace: toEvaluationTrace(dto.evaluation_trace),
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    steps: dto.steps.map(toWorkflowStepModel),
  });
}

export function toWorkflowStepModel(dto: WorkflowStepModelDto): Step {
  return {
    id: dto.id,
    jobExecutionId: dto.job_execution_id,
    key: dto.key,
    name: dto.name,
    sourceLocation: dto.source_location
      ? {startLine: dto.source_location.start_line, endLine: dto.source_location.end_line}
      : null,
    status: dto.status,
    statusReason: dto.status_reason,
    type: dto.type,
    config: dto.config,
    evaluationTrace: toEvaluationTrace(dto.evaluation_trace),
    agentConfig: toWorkflowAgentStepConfig(dto),
    toolConfig: toWorkflowToolStepConfig(dto),
    error: toWorkflowJobStepError(dto.error),
    position: dto.position,
    currentAttempt: dto.current_attempt,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    attempts: dto.attempts.map((attempt) =>
      toWorkflowStepAttemptModel(attempt, dto.job_execution_id),
    ),
  };
}

export function toWorkflowStepAttemptModel(
  dto: StepAttemptDto,
  jobExecutionId: string,
): StepAttempt {
  return new StepAttempt({
    id: dto.id,
    stepId: dto.step_id,
    jobExecutionId,
    attempt: dto.attempt,
    executionOrder: dto.execution_order,
    status: dto.status,
    exitCode: dto.exit_code,
    output: dto.output,
    outputs: dto.outputs ?? dto.output,
    response: dto.response,
    error: dto.error,
    gateResult: toStepGateResult(dto.gate_result),
    restartFeedback: dto.restart_feedback,
    invocations: dto.invocations.map(toStepAttemptInvocation),
    startedAt: dto.started_at,
    finishedAt: dto.finished_at,
  });
}

function toWorkflowJobListening(dto: JobListeningDto): JobListening {
  return {
    on: dto.on,
    until: dto.until,
    timeoutMs: dto.timeout_ms,
    maxExecutions: dto.max_executions,
    batch: dto.batch
      ? {
          debounceMs: dto.batch.debounce_ms,
          maxSize: dto.batch.max_size,
          maxWaitMs: dto.batch.max_wait_ms,
        }
      : null,
    onResolve: dto.on_resolve,
    executionTimeoutMs: dto.execution_timeout_ms,
    name: dto.name,
  };
}

function toWorkflowAgentStepConfig(dto: WorkflowStepModelDto): Step['agentConfig'] {
  if (dto.type !== 'agent') return null;
  return {
    provider: stringConfigValue(dto.config.provider),
    model: stringConfigValue(dto.config.model),
    thinking: stringConfigValue(dto.config.thinking),
  };
}

function toWorkflowToolStepConfig(dto: WorkflowStepModelDto): Step['toolConfig'] {
  if (dto.type !== 'tool') return null;
  const tool = recordConfigValue(dto.config.tool);
  const sensitivity = tool?.sensitivity;
  const method = stringConfigValue(tool?.method);
  return {
    provider: stringConfigValue(tool?.provider),
    connectionSlug: stringConfigValue(tool?.connection_slug),
    toolId: stringConfigValue(tool?.id),
    ...(method === null ? {} : {method}),
    sensitivity: sensitivity === 'read' || sensitivity === 'write' ? sensitivity : null,
  };
}

function stringConfigValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
