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

/** Returns the number of bytes that a diagnostic value occupies at its JSON/text boundary. */
export function diagnosticValueByteLength(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');

  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 0 : Buffer.byteLength(serialized, 'utf8');
  } catch {
    // PostgreSQL JSONB would reject this value as well. Treat it as over the
    // limit so the owning write fails before attempting the database mutation.
    return Number.POSITIVE_INFINITY;
  }
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

/** Retains a legacy value only when it can safely be copied to a new row. */
export function boundedLegacyDiagnosticValue<T>(
  field: WorkflowDiagnosticFieldDto,
  value: T | null | undefined,
): T | null | undefined {
  if (value === null || value === undefined) return value;
  return diagnosticValueByteLength(value) <= diagnosticByteLimit(field) ? value : null;
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
