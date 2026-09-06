import {MAX_WORKFLOW_FILE_BYTES} from '@shipfox/api-definitions-dto';
import {
  MAX_LISTENER_FILTER_SNAPSHOT_BYTES,
  MAX_LISTENER_TRIGGER_EVENTS_BYTES,
  MAX_RESOLVED_STEP_CONFIG_BYTES,
  STEP_RESPONSE_MAX_LENGTH,
  WORKFLOW_DIAGNOSTIC_CONDITION_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_CONFIG_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_ERROR_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_EVALUATION_TRACE_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_GATE_RESULT_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_OUTPUT_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_RESPONSE_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_TRIGGER_EVENTS_MAX_BYTES,
  type WorkflowDiagnosticFieldDto,
  type WorkflowExecutionPayloadFieldDto,
} from '@shipfox/api-workflows-dto';
import {
  recordWorkflowDiagnosticOversized,
  recordWorkflowExecutionPayloadSize,
} from '#metrics/instance.js';
import {
  JobOutputTooLargeError,
  WorkflowExecutionPayloadTooLargeError,
  WorkflowStepAttemptInvocationLimitError,
  WorkflowStepResultTooLargeError,
} from './errors.js';
import {MAX_JOB_OUTPUTS_TOTAL_BYTES} from './step-config/job-output-limits.js';

/** Producer-side cap; the DTO only exposes the larger read allowance. */
export const WORKFLOW_STEP_ATTEMPT_INVOCATION_WRITE_MAX = 3;
const JSON_EXPONENT_PATTERN = /[eE]/;

// These are producer-side result limits. They intentionally do not go through
// diagnosticByteLimit: an inline read budget can change independently of the
// contracts that govern values written by a step transition.
const WORKFLOW_STEP_RESULT_WRITE_LIMITS = {
  response: STEP_RESPONSE_MAX_LENGTH,
  error: 16 * 1024,
  gate_result: 16 * 1024,
  restart_feedback: 8 * 1024,
} as const;

/** Returns the number of bytes that a diagnostic value occupies at its JSON/text boundary. */
export function diagnosticValueByteLength(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');

  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 0 : postgresJsonTextByteLength(serialized);
  } catch {
    // PostgreSQL JSONB would reject this value as well. Treat it as over the
    // limit so the owning write fails before attempting the database mutation.
    return Number.POSITIVE_INFINITY;
  }
}

/** Returns the number of bytes in the JSON representation sent across execution boundaries. */
export function executionPayloadValueByteLength(value: unknown): number {
  if (value === null || value === undefined) return 0;

  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 0 : Buffer.byteLength(serialized, 'utf8');
  } catch {
    // The execution boundary cannot carry values that the JSON serializer cannot
    // represent. Treat them as over the limit so the owning write fails early.
    return Number.POSITIVE_INFINITY;
  }
}

// PostgreSQL renders JSONB with a space after each structural comma and colon,
// and expands exponent-form numbers. Render those two differences on top of
// JSON.stringify so application-side write checks use the same metric as the
// SQL read guards, including near the limit.
function postgresJsonTextByteLength(serialized: string): number {
  let byteLength = 0;
  let index = 0;
  while (index < serialized.length) {
    const token = readJsonToken(serialized, index);
    byteLength += Buffer.byteLength(token.text, 'utf8');
    index = token.nextIndex;
  }
  return byteLength;
}

function readJsonToken(serialized: string, index: number): {text: string; nextIndex: number} {
  const character = serialized[index];
  if (character === '"') return readJsonStringToken(serialized, index);
  if (character === ',' || character === ':') {
    return {text: `${character} `, nextIndex: index + 1};
  }
  if (isJsonNumberStart(character)) return readJsonNumberToken(serialized, index);
  return {text: character ?? '', nextIndex: index + 1};
}

function readJsonStringToken(serialized: string, start: number): {text: string; nextIndex: number} {
  let escaped = false;
  for (let index = start + 1; index < serialized.length; index += 1) {
    const character = serialized[index];
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"') {
      return {text: serialized.slice(start, index + 1), nextIndex: index + 1};
    }
  }
  return {text: serialized.slice(start), nextIndex: serialized.length};
}

function readJsonNumberToken(serialized: string, start: number): {text: string; nextIndex: number} {
  let index = start + 1;
  while (index < serialized.length && isJsonNumberCharacter(serialized[index])) index += 1;
  return {
    text: expandJsonNumber(serialized.slice(start, index)),
    nextIndex: index,
  };
}

function isJsonNumberStart(character: string | undefined): boolean {
  return character === '-' || (character !== undefined && character >= '0' && character <= '9');
}

function isJsonNumberCharacter(character: string | undefined): boolean {
  return (
    character === '-' ||
    character === '+' ||
    character === '.' ||
    character === 'e' ||
    character === 'E' ||
    (character !== undefined && character >= '0' && character <= '9')
  );
}

function expandJsonNumber(value: string): string {
  const exponentIndex = value.search(JSON_EXPONENT_PATTERN);
  if (exponentIndex === -1) return value;

  const mantissa = value.slice(0, exponentIndex);
  const exponent = Number(value.slice(exponentIndex + 1));
  const sign = mantissa.startsWith('-') ? '-' : '';
  const unsignedMantissa = sign === '' ? mantissa : mantissa.slice(1);
  const digits = unsignedMantissa.replace('.', '');
  const decimalIndex =
    (unsignedMantissa.indexOf('.') === -1
      ? unsignedMantissa.length
      : unsignedMantissa.indexOf('.')) + exponent;

  if (decimalIndex <= 0) return `${sign}0.${'0'.repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length)
    return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

export function diagnosticByteLimit(field: WorkflowDiagnosticFieldDto): number {
  switch (field) {
    case 'authored_config':
    case 'config':
      return WORKFLOW_DIAGNOSTIC_CONFIG_MAX_BYTES;
    case 'evaluation_trace':
    case 'job_evaluation_trace':
    case 'execution_evaluation_trace':
      return WORKFLOW_DIAGNOSTIC_EVALUATION_TRACE_MAX_BYTES;
    case 'output':
    case 'outputs':
    case 'job_outputs':
    case 'execution_outputs':
      return WORKFLOW_DIAGNOSTIC_OUTPUT_MAX_BYTES;
    case 'response':
    case 'restart_feedback':
      return WORKFLOW_DIAGNOSTIC_RESPONSE_MAX_BYTES;
    case 'error':
      return WORKFLOW_DIAGNOSTIC_ERROR_MAX_BYTES;
    case 'gate_result':
      return WORKFLOW_DIAGNOSTIC_GATE_RESULT_MAX_BYTES;
    case 'condition':
      return WORKFLOW_DIAGNOSTIC_CONDITION_MAX_BYTES;
    case 'trigger_events':
      return WORKFLOW_DIAGNOSTIC_TRIGGER_EVENTS_MAX_BYTES;
    case 'filter_snapshot':
      return MAX_LISTENER_FILTER_SNAPSHOT_BYTES;
  }
}

function executionPayloadByteLimit(field: WorkflowExecutionPayloadFieldDto): number {
  switch (field) {
    case 'resolved_config':
      return MAX_RESOLVED_STEP_CONFIG_BYTES;
    case 'authored_config':
    case 'config_plan':
    case 'condition':
      return MAX_WORKFLOW_FILE_BYTES;
    case 'listener_batch':
      return MAX_LISTENER_TRIGGER_EVENTS_BYTES;
    case 'filter_snapshot':
      return MAX_LISTENER_FILTER_SNAPSHOT_BYTES;
  }
}

function diagnosticFieldForExecutionPayload(
  field: WorkflowExecutionPayloadFieldDto,
): WorkflowDiagnosticFieldDto {
  switch (field) {
    case 'condition':
      return 'condition';
    case 'listener_batch':
      return 'trigger_events';
    case 'filter_snapshot':
      return 'filter_snapshot';
    case 'resolved_config':
    case 'config_plan':
      return 'config';
    case 'authored_config':
      return 'authored_config';
  }
}

/** Checks a value against the limit owned by its execution boundary. */
export function assertWorkflowExecutionPayloadSize(
  field: WorkflowExecutionPayloadFieldDto,
  value: unknown,
): void {
  if (value === null || value === undefined) return;
  const measuredBytes = executionPayloadValueByteLength(value);
  const limitBytes = executionPayloadByteLimit(field);
  const diagnosticField = diagnosticFieldForExecutionPayload(field);
  if (measuredBytes > diagnosticByteLimit(diagnosticField)) {
    recordWorkflowDiagnosticOversized(diagnosticField, 'current_value_exceeds_inline_limit');
  }
  recordWorkflowExecutionPayloadSize(
    field,
    measuredBytes,
    measuredBytes > limitBytes ? 'rejected' : 'accepted',
  );
  if (measuredBytes > limitBytes) {
    throw new WorkflowExecutionPayloadTooLargeError(field, limitBytes, measuredBytes);
  }
}

/**
 * Records an observation that is too large for an inline diagnostic read. This
 * deliberately never throws: observations must not prevent their owning state
 * transition from being committed.
 */
export function observeWorkflowDiagnosticSize(
  field: WorkflowDiagnosticFieldDto,
  value: unknown,
): void {
  if (value === null || value === undefined) return;
  const measuredBytes = diagnosticValueByteLength(value);
  if (measuredBytes > diagnosticByteLimit(field)) {
    recordWorkflowDiagnosticOversized(field, 'current_value_exceeds_inline_limit');
  }
}

/** Product outputs retain the existing 256 KiB persisted total cap. */
export function assertWorkflowProductOutputSize(
  field: 'output' | 'job_outputs' | 'execution_outputs',
  value: unknown,
): void {
  if (value === null || value === undefined) return;
  const measuredBytes = diagnosticValueByteLength(value);
  if (measuredBytes > MAX_JOB_OUTPUTS_TOTAL_BYTES) {
    recordWorkflowDiagnosticOversized(field, 'current_value_exceeds_inline_limit');
    throw new JobOutputTooLargeError(field, MAX_JOB_OUTPUTS_TOTAL_BYTES, measuredBytes, 'total');
  }
}

export function assertWorkflowStepOutputSize(value: unknown): void {
  assertWorkflowProductOutputSize('output', value);
}

/** Checks a generated step result using its explicit result-field policy. */
export function assertWorkflowStepResultSize(
  field: Extract<
    WorkflowDiagnosticFieldDto,
    'response' | 'error' | 'gate_result' | 'restart_feedback'
  >,
  value: unknown,
): void {
  if (value === null || value === undefined) return;
  const measuredBytes = diagnosticValueByteLength(value);
  const limitBytes = WORKFLOW_STEP_RESULT_WRITE_LIMITS[field];
  if (measuredBytes > limitBytes) {
    recordWorkflowDiagnosticOversized(field, 'current_value_exceeds_inline_limit');
    throw new WorkflowStepResultTooLargeError(field, limitBytes, measuredBytes);
  }
}

export function workflowStepResultTooLargeError(
  error: WorkflowStepResultTooLargeError,
): Record<string, unknown> {
  return {
    message: error.message,
    code: 'step_result_too_large',
    reason: 'step_result_too_large',
    field: error.field,
    source: 'workflows',
    retryable: false,
    limitBytes: error.limitBytes,
    measuredBytes: error.measuredBytes,
    overshootBytes: error.overshootBytes,
  };
}

export function boundWorkflowStepResult<T>(
  field: Extract<
    WorkflowDiagnosticFieldDto,
    'response' | 'error' | 'gate_result' | 'restart_feedback'
  >,
  value: T | null | undefined,
): {value: T | null; error: Record<string, unknown> | null} {
  if (value === null || value === undefined) return {value: null, error: null};
  try {
    assertWorkflowStepResultSize(field, value);
    return {value, error: null};
  } catch (cause) {
    if (!(cause instanceof WorkflowStepResultTooLargeError)) throw cause;
    recordWorkflowDiagnosticOversized(field, 'value_truncated_at_write_limit');
    return {value: null, error: workflowStepResultTooLargeError(cause)};
  }
}

/** Replaces an oversized raw failure with a small typed error before persistence. */
export function boundWorkflowStepError(
  error: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  return (
    boundWorkflowStepResult('error', error).error ??
    (error === null || error === undefined ? null : error)
  );
}

export function assertWorkflowStepAttemptInvocationCount(count: number, previousCount = 0): void {
  // A deployment can encounter a legacy row above the current write cap. An
  // in-place status update must remain possible; only growing that history is
  // rejected.
  if (count > WORKFLOW_STEP_ATTEMPT_INVOCATION_WRITE_MAX && count > previousCount) {
    throw new WorkflowStepAttemptInvocationLimitError(
      count,
      WORKFLOW_STEP_ATTEMPT_INVOCATION_WRITE_MAX,
    );
  }
}
