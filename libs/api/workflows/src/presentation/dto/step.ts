import {
  agentConfigIssueSchema,
  agentStepSessionDescriptorSchema,
  deriveStepErrorCategory,
  type StepAttemptDetailResponseDto,
  type StepAttemptDto,
  type StepDto,
  type StepErrorDto,
  type StepGateResultDto,
  stepErrorReasonSchema,
} from '@shipfox/api-workflows-dto';
import type {Step, StepAttempt} from '#core/entities/step.js';
import {GATE_EVALUATION_ERROR_REASON} from '#core/step-transition/evaluate-gate.js';
import {toEvaluationTraceDto} from './evaluation-trace.js';

// Domain `error` is loosely typed (jsonb), so narrow it to the fixed runner
// contract rather than trusting whatever shape the row happens to hold. `category`
// is not stored on the row; the caller derives it from the step type and error
// reason (server-authoritative, never trusted from the runner).
function toStepErrorDto(error: Record<string, unknown> | null, stepType: string): StepErrorDto {
  if (error === null) return null;
  const message = typeof error.message === 'string' ? error.message : '';
  const code = typeof error.code === 'string' ? error.code : undefined;
  const managedProviderId =
    typeof error.managedProviderId === 'string' ? error.managedProviderId : undefined;
  const exitCode = error.exitCode;
  const signal = typeof error.signal === 'string' ? error.signal : undefined;
  const field = typeof error.field === 'string' ? error.field : undefined;
  const source = typeof error.source === 'string' ? error.source : undefined;
  const reason = stepErrorReasonSchema.safeParse(error.reason);
  const agentConfigIssue = agentConfigIssueSchema.safeParse(error.agentConfigIssue);
  const category = deriveStepErrorCategory(stepType, reason.success ? reason.data : undefined);
  return {
    message,
    ...toStepErrorScalarFields({code, managedProviderId, exitCode, signal}),
    ...(reason.success ? {reason: reason.data} : {}),
    ...toStepErrorSourceFields(field, source),
    ...(agentConfigIssue.success ? {agent_config_issue: agentConfigIssue.data} : {}),
    category,
  };
}

function toStepErrorScalarFields(params: {
  code: string | undefined;
  managedProviderId: string | undefined;
  exitCode: unknown;
  signal: string | undefined;
}): Partial<StepErrorDto> {
  return {
    ...(params.code === undefined ? {} : {code: params.code}),
    ...(params.managedProviderId === undefined
      ? {}
      : {managed_provider_id: params.managedProviderId}),
    ...(params.exitCode === null || typeof params.exitCode === 'number'
      ? {exit_code: params.exitCode}
      : {}),
    ...(params.signal === undefined ? {} : {signal: params.signal}),
  };
}

function toStepErrorSourceFields(
  field: string | undefined,
  source: string | undefined,
): Partial<StepErrorDto> {
  return {
    ...(field === undefined ? {} : {field}),
    ...(source === undefined ? {} : {source}),
  };
}

// Inverse of toStepErrorDto: reported wire errors land on the domain row in
// camelCase so the read path renders them back without a special case. `category`
// is intentionally NOT persisted: the server derives it from the step type and
// reason on read, so a runner-supplied category is ignored here.
export function fromStepErrorDto(error: StepErrorDto | undefined): Record<string, unknown> | null {
  if (!error) return null;
  return {
    message: error.message,
    ...(error.code === undefined ? {} : {code: error.code}),
    ...(error.managed_provider_id === undefined
      ? {}
      : {managedProviderId: error.managed_provider_id}),
    ...(error.exit_code === null || typeof error.exit_code === 'number'
      ? {exitCode: error.exit_code}
      : {}),
    ...(typeof error.signal === 'string' ? {signal: error.signal} : {}),
    ...(error.reason === undefined ? {} : {reason: error.reason}),
    ...(error.field === undefined ? {} : {field: error.field}),
    ...(error.source === undefined ? {} : {source: error.source}),
    ...(error.agent_config_issue === undefined ? {} : {agentConfigIssue: error.agent_config_issue}),
  };
}

function isIntOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value));
}

function toStepGateResultDto(
  gateResult: Record<string, unknown> | null,
  status: string,
): StepGateResultDto {
  if (gateResult === null) {
    return status === 'running' || status === 'pending' ? {kind: 'not_evaluated'} : {kind: 'none'};
  }

  const exitCode = gateResult.exit_code;
  const passed = gateResult.passed;
  const source = gateResult.source;
  const reason = gateResult.reason;

  if (passed === true && typeof source === 'string' && isIntOrNull(exitCode)) {
    return {kind: 'passed', passed, source, exit_code: exitCode};
  }

  if (
    passed === false &&
    gateResult.uncheckable === true &&
    typeof reason === 'string' &&
    isIntOrNull(exitCode)
  ) {
    if (reason === GATE_EVALUATION_ERROR_REASON) {
      return {kind: 'evaluation_error', reason, exit_code: exitCode};
    }
    return {kind: 'uncheckable', passed, uncheckable: true, reason, exit_code: exitCode};
  }

  if (passed === false && typeof source === 'string' && isIntOrNull(exitCode)) {
    return {kind: 'failed', passed, source, exit_code: exitCode};
  }

  return {kind: 'unknown', data: gateResult};
}

function toSessionDto(config: Record<string, unknown> | null): StepDto['session'] {
  const sessionValue = config?.session;
  if (sessionValue === undefined || sessionValue === null) return null;
  const session = agentStepSessionDescriptorSchema.safeParse(sessionValue);
  return session.success ? session.data : null;
}

export function toStepDto(step: Step): StepDto {
  const session = toSessionDto(step.config);
  return {
    id: step.id,
    job_execution_id: step.jobExecutionId,
    key: step.key,
    name: step.name,
    source_location: toStepSourceLocationDto(step.sourceLocation),
    status: step.status,
    status_reason: step.statusReason,
    type: step.type,
    config: step.config,
    evaluation_trace: toEvaluationTraceDto(step.evaluationTrace),
    error: toStepErrorDto(step.error, step.type),
    session,
    position: step.position,
    current_attempt: step.currentAttempt,
    created_at: step.createdAt.toISOString(),
    updated_at: step.updatedAt.toISOString(),
  };
}

function toStepSourceLocationDto(
  sourceLocation: Step['sourceLocation'],
): StepDto['source_location'] {
  if (sourceLocation === null) return null;
  return {
    start_line: sourceLocation.startLine,
    end_line: sourceLocation.endLine,
  };
}

export function toStepAttemptDto(attempt: StepAttempt): StepAttemptDto {
  return {
    id: attempt.id,
    step_id: attempt.stepId,
    attempt: attempt.attempt,
    execution_order: attempt.executionOrder,
    status: attempt.status,
    exit_code: attempt.exitCode,
    output: attempt.output,
    outputs: attempt.output,
    response: attempt.response,
    error: attempt.error,
    gate_result: toStepGateResultDto(attempt.gateResult, attempt.status),
    restart_feedback: attempt.restartFeedback,
    invocations: [...attempt.invocations],
    started_at: attempt.startedAt.toISOString(),
    finished_at: attempt.finishedAt ? attempt.finishedAt.toISOString() : null,
  };
}

export function toStepAttemptDetailResponseDto(
  step: Step,
  attempt: StepAttempt,
): StepAttemptDetailResponseDto {
  return {
    step_id: step.id,
    attempt: attempt.attempt,
    authored_config: step.authoredConfig,
    config: attempt.config,
    session: toSessionDto(attempt.config),
    evaluation_trace: toEvaluationTraceDto(attempt.evaluationTrace),
  };
}
