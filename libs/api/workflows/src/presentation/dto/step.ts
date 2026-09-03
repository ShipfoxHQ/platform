import {
  agentConfigIssueSchema,
  agentStepSessionDescriptorSchema,
  deriveStepErrorCategory,
  STEP_ERROR_MESSAGE_MAX_LENGTH,
  type StepAttemptDetailResponseDto,
  type StepAttemptDto,
  type StepDto,
  type StepErrorDto,
  type StepGateResultDto,
  stepErrorReasonSchema,
  WORKFLOW_STEP_ATTEMPT_INVOCATION_READ_MAX,
  WORKFLOW_STEP_CONFIG_INLINE_MAX_BYTES,
} from '@shipfox/api-workflows-dto';
import type {Step, StepAttempt} from '#core/entities/step.js';
import {GATE_EVALUATION_ERROR_REASON} from '#core/step-transition/evaluate-gate.js';
import type {StepAttemptDetailStep} from '#db/workflow-runs/steps.js';
import {toEvaluationTraceDto} from './evaluation-trace.js';
import {inlineDiagnostic} from './workflow-run-diagnostics.js';

export function truncateStepText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const truncated = value.slice(0, maxLength);
  const lastCodeUnit = truncated.charCodeAt(truncated.length - 1);
  return lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff ? truncated.slice(0, -1) : truncated;
}

// Domain `error` is loosely typed (jsonb), so narrow it to the fixed runner
// contract rather than trusting whatever shape the row happens to hold. `category`
// is not stored on the row; the caller derives it from the step type and error
// reason (server-authoritative, never trusted from the runner).
export function toStepErrorDto(
  error: Record<string, unknown> | null,
  stepType: string,
): StepErrorDto {
  if (error === null) return null;
  const message =
    typeof error.message === 'string'
      ? truncateStepText(error.message, STEP_ERROR_MESSAGE_MAX_LENGTH)
      : '';
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
    ...(typeof error.retryable === 'boolean' ? {retryable: error.retryable} : {}),
    ...(typeof error.limitBytes === 'number' ? {limit_bytes: error.limitBytes} : {}),
    ...(typeof error.measuredBytes === 'number' ? {measured_bytes: error.measuredBytes} : {}),
    ...(typeof error.overshootBytes === 'number' ? {overshoot_bytes: error.overshootBytes} : {}),
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
    ...(error.retryable === undefined ? {} : {retryable: error.retryable}),
    ...(error.limit_bytes === undefined ? {} : {limitBytes: error.limit_bytes}),
    ...(error.measured_bytes === undefined ? {} : {measuredBytes: error.measured_bytes}),
    ...(error.overshoot_bytes === undefined ? {} : {overshootBytes: error.overshoot_bytes}),
  };
}

function isIntOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value));
}

export function toStepGateResultDto(
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
    return {
      kind: 'passed',
      passed,
      source: truncateStepText(source, STEP_ERROR_MESSAGE_MAX_LENGTH),
      exit_code: exitCode,
    };
  }

  if (
    passed === false &&
    gateResult.uncheckable === true &&
    typeof reason === 'string' &&
    isIntOrNull(exitCode)
  ) {
    if (reason === GATE_EVALUATION_ERROR_REASON) {
      return {
        kind: 'evaluation_error',
        reason: truncateStepText(reason, STEP_ERROR_MESSAGE_MAX_LENGTH),
        exit_code: exitCode,
      };
    }
    return {
      kind: 'uncheckable',
      passed,
      uncheckable: true,
      reason: truncateStepText(reason, STEP_ERROR_MESSAGE_MAX_LENGTH),
      exit_code: exitCode,
    };
  }

  if (passed === false && typeof source === 'string' && isIntOrNull(exitCode)) {
    return {
      kind: 'failed',
      passed,
      source: truncateStepText(source, STEP_ERROR_MESSAGE_MAX_LENGTH),
      exit_code: exitCode,
    };
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
  const restartFeedback = inlineDiagnostic('restart_feedback', attempt.restartFeedback);
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
    restart_feedback: restartFeedback.value,
    invocations: attempt.invocations.slice(0, WORKFLOW_STEP_ATTEMPT_INVOCATION_READ_MAX),
    started_at: attempt.startedAt.toISOString(),
    finished_at: attempt.finishedAt ? attempt.finishedAt.toISOString() : null,
  };
}

export function toStepAttemptDetailResponseDto(
  step: StepAttemptDetailStep,
  attempt: StepAttempt,
  ancestry: {
    workflowRunId: string;
    workflowRunAttempt: number;
    jobId: string;
    jobExecutionId: string;
  },
  diagnosticBytes?: {
    authoredConfig?: number | null;
    config?: number | null;
    evaluationTrace?: number | null;
  },
): StepAttemptDetailResponseDto {
  const stepConfigDiagnosticOptions = {
    limitBytes: WORKFLOW_STEP_CONFIG_INLINE_MAX_BYTES,
    reason: 'value_exceeds_inline_limit' as const,
  };
  const authoredConfig = inlineDiagnostic(
    'authored_config',
    step.authoredConfig,
    diagnosticBytes?.authoredConfig,
    stepConfigDiagnosticOptions,
  );
  const config = inlineDiagnostic(
    'config',
    attempt.config,
    diagnosticBytes?.config,
    stepConfigDiagnosticOptions,
  );
  const evaluationTrace = inlineDiagnostic(
    'evaluation_trace',
    attempt.evaluationTrace,
    diagnosticBytes?.evaluationTrace,
  );
  const output = inlineDiagnostic('output', attempt.output);
  const outputs = inlineDiagnostic('outputs', attempt.output);
  const response = inlineDiagnostic('response', attempt.response);
  const error = inlineDiagnostic('error', attempt.error);
  const gateResult = inlineDiagnostic('gate_result', attempt.gateResult);
  const restartFeedback = inlineDiagnostic('restart_feedback', attempt.restartFeedback);

  return {
    workflow_run_id: ancestry.workflowRunId,
    workflow_run_attempt: ancestry.workflowRunAttempt,
    job_id: ancestry.jobId,
    job_execution_id: ancestry.jobExecutionId,
    step_id: step.id,
    step_attempt_id: attempt.id,
    attempt: attempt.attempt,
    authored_config: authoredConfig.value,
    config: config.value,
    session: config.value === null ? null : toSessionDto(config.value),
    evaluation_trace:
      evaluationTrace.value === null ? null : toEvaluationTraceDto(evaluationTrace.value),
    output: output.value,
    outputs: outputs.value,
    response: response.value,
    error: error.value === null ? null : toStepErrorDto(error.value, step.type),
    gate_result:
      gateResult.oversized !== null ? null : toStepGateResultDto(gateResult.value, attempt.status),
    invocations: attempt.invocations.slice(0, WORKFLOW_STEP_ATTEMPT_INVOCATION_READ_MAX),
    restart_feedback: restartFeedback.value,
    oversized_fields: [
      authoredConfig.oversized,
      config.oversized,
      evaluationTrace.oversized,
      output.oversized,
      outputs.oversized,
      response.oversized,
      error.oversized,
      gateResult.oversized,
      restartFeedback.oversized,
    ].filter((field): field is NonNullable<typeof field> => field !== null),
  };
}
