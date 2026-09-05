import type {
  EvaluationTraceDto,
  StepAttemptDto,
  StepErrorDto,
  StepGateResultDto,
  StepGateResultSummaryDto,
  WorkflowExecutionEventDto,
} from '@shipfox/api-workflows-dto';
import type {
  EvaluationTraceEntry,
  StepError,
  StepGateResult,
  WorkflowExecutionEvent,
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
