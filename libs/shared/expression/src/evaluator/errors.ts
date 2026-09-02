import {EvaluationError} from '@marcbachmann/cel-js';

export const workflowExpressionEvaluationErrorCode = 'workflow-expression-evaluation-failed';

export type WorkflowExpressionEvaluationFailureReason = 'missing-path' | 'evaluation-error';

const MAX_WORKFLOW_EXPRESSION_EVALUATION_SUMMARY_LENGTH = 200;
const SAFE_CEL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const SAFE_CEL_ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_INDEX_OUT_OF_BOUNDS_SUMMARY =
  /^No such key: index out of bounds, index (-?\d{1,9}) (< 0|>= size \d{1,9})$/;

export class WorkflowExpressionEvaluationError extends Error {
  readonly code = workflowExpressionEvaluationErrorCode;
  readonly reason: WorkflowExpressionEvaluationFailureReason;
  /** A bounded diagnostic with runtime values removed before persistence. */
  readonly summary: string;

  constructor(cause: unknown) {
    super('Workflow expression evaluation failed', {cause});
    this.name = 'WorkflowExpressionEvaluationError';
    this.reason =
      cause instanceof EvaluationError &&
      (cause.code === 'no_such_key' || cause.code === 'unknown_variable')
        ? 'missing-path'
        : 'evaluation-error';
    this.summary = boundedWorkflowExpressionEvaluationSummary(cause);
  }
}

function boundedWorkflowExpressionEvaluationSummary(cause: unknown): string {
  const summary = workflowExpressionEvaluationSummary(cause);
  return summary.length <= MAX_WORKFLOW_EXPRESSION_EVALUATION_SUMMARY_LENGTH
    ? summary
    : `${summary.slice(0, MAX_WORKFLOW_EXPRESSION_EVALUATION_SUMMARY_LENGTH - 1)}…`;
}

function workflowExpressionEvaluationSummary(cause: unknown): string {
  if (!(cause instanceof EvaluationError)) return 'CEL evaluation failed';

  if (cause.code === 'no_such_key') {
    return missingKeySummary(cause);
  }

  if (cause.code === 'index_out_of_bounds') {
    return indexOutOfBoundsSummary(cause);
  }

  const code = safeCelErrorCode(cause.code);
  return code === undefined ? 'CEL evaluation failed' : `CEL evaluation failed (${code})`;
}

function missingKeySummary(error: EvaluationError): string {
  if (error.node?.op !== '.' && error.node?.op !== '.?') return 'No such key';

  const key = error.node.args[1];
  return typeof key === 'string' && SAFE_CEL_IDENTIFIER.test(key)
    ? `No such key: ${key}`
    : 'No such key';
}

function indexOutOfBoundsSummary(error: EvaluationError): string {
  const match = SAFE_INDEX_OUT_OF_BOUNDS_SUMMARY.exec(error.summary);
  return match === null
    ? 'No such key: index out of bounds'
    : `No such key: index out of bounds, index ${match[1]} ${match[2]}`;
}

function safeCelErrorCode(code: string): string | undefined {
  return SAFE_CEL_ERROR_CODE.test(code) ? code : undefined;
}
