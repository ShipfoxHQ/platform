import {type ASTNode, EvaluationError} from '@marcbachmann/cel-js';

export const workflowExpressionEvaluationErrorCode = 'workflow-expression-evaluation-failed';

export type WorkflowExpressionEvaluationFailureReason = 'missing-path' | 'evaluation-error';

export type WorkflowExpressionEvaluationDetail =
  | {kind: 'missing-path'; path?: string | undefined}
  | {kind: 'index-out-of-bounds'; index: number; size?: number | undefined}
  | {kind: 'evaluation-error'; classification?: string | undefined};

const MAX_WORKFLOW_EXPRESSION_EVALUATION_SUMMARY_LENGTH = 200;
const SAFE_CEL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const SAFE_CEL_ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_INDEX_OUT_OF_BOUNDS_SUMMARY =
  /^No such key: index out of bounds, index (-?\d{1,9}) (< 0|>= size \d{1,9})$/;
const SAFE_INDEX_OUT_OF_BOUNDS_SIZE = />= size (\d{1,9})$/;

export class WorkflowExpressionEvaluationError extends Error {
  readonly code = workflowExpressionEvaluationErrorCode;
  readonly reason: WorkflowExpressionEvaluationFailureReason;
  /** A bounded diagnostic with runtime values removed before persistence. */
  readonly summary: string;
  /** Structured, bounded diagnostic fields safe to persist and render. */
  readonly detail: WorkflowExpressionEvaluationDetail;

  constructor(cause: unknown) {
    super('Workflow expression evaluation failed', {cause});
    this.name = 'WorkflowExpressionEvaluationError';
    this.reason =
      cause instanceof EvaluationError &&
      (cause.code === 'no_such_key' || cause.code === 'unknown_variable')
        ? 'missing-path'
        : 'evaluation-error';
    this.summary = boundedWorkflowExpressionEvaluationSummary(cause);
    this.detail = workflowExpressionEvaluationDetail(cause);
  }
}

function workflowExpressionEvaluationDetail(cause: unknown): WorkflowExpressionEvaluationDetail {
  if (!(cause instanceof EvaluationError)) return {kind: 'evaluation-error'};

  if (cause.code === 'no_such_key' || cause.code === 'unknown_variable') {
    const path = cause.node === undefined ? undefined : safeDottedPath(cause.node);
    return {kind: 'missing-path', ...(path === undefined ? {} : {path})};
  }

  if (cause.code === 'index_out_of_bounds') {
    return indexOutOfBoundsDetail(cause);
  }

  const classification = safeCelErrorCode(cause.code);
  return {
    kind: 'evaluation-error',
    ...(classification === undefined ? {} : {classification}),
  };
}

function indexOutOfBoundsDetail(error: EvaluationError): WorkflowExpressionEvaluationDetail {
  const match = SAFE_INDEX_OUT_OF_BOUNDS_SUMMARY.exec(error.summary);
  if (match === null) return {kind: 'evaluation-error', classification: 'index_out_of_bounds'};
  const index = Number(match[1]);
  if (!Number.isSafeInteger(index)) {
    return {kind: 'evaluation-error', classification: 'index_out_of_bounds'};
  }
  const sizeMatch = SAFE_INDEX_OUT_OF_BOUNDS_SIZE.exec(match[2] ?? '');
  return {
    kind: 'index-out-of-bounds',
    index,
    ...(sizeMatch === null ? {} : {size: Number(sizeMatch[1])}),
  };
}

function safeDottedPath(node: ASTNode): string | undefined {
  if (node.op === 'id') return SAFE_CEL_IDENTIFIER.test(node.args) ? node.args : undefined;
  if (node.op !== '.' && node.op !== '.?') return undefined;

  const [parent, key] = node.args;
  const parentPath = safeDottedPath(parent);
  if (parentPath === undefined || !SAFE_CEL_IDENTIFIER.test(key)) return undefined;
  const path = `${parentPath}.${key}`;
  return path.length <= MAX_WORKFLOW_EXPRESSION_EVALUATION_SUMMARY_LENGTH ? path : undefined;
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
