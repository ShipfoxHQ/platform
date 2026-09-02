import {
  WORKFLOW_DIAGNOSTIC_CONDITION_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_CONFIG_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_ERROR_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_EVALUATION_TRACE_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_GATE_RESULT_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_OUTPUT_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_RESPONSE_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_TRIGGER_EVENTS_MAX_BYTES,
  type WorkflowDiagnosticFieldDto,
} from '@shipfox/api-workflows-dto';
import {
  WorkflowDiagnosticTooLargeError,
  WorkflowStepAttemptInvocationLimitError,
} from './errors.js';

/** Producer-side cap; the DTO only exposes the larger read allowance. */
export const WORKFLOW_STEP_ATTEMPT_INVOCATION_WRITE_MAX = 3;
const JSON_EXPONENT_PATTERN = /[eE]/;

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
  }
}

/** Checks one owning write before its row is inserted or updated. */
export function assertWorkflowDiagnosticSize(
  field: WorkflowDiagnosticFieldDto,
  value: unknown,
): void {
  if (value === null || value === undefined) return;
  const measuredBytes = diagnosticValueByteLength(value);
  const limitBytes = diagnosticByteLimit(field);
  if (measuredBytes > limitBytes) {
    throw new WorkflowDiagnosticTooLargeError(field, limitBytes, measuredBytes);
  }
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
