import {
  createWorkflowExpression,
  evaluateWorkflowExpression,
  InvalidWorkflowExpressionError,
  projectWorkflowPredicateContext,
  type WorkflowExpression,
  WorkflowExpressionEvaluationError,
} from '@shipfox/expression';
import type {
  TriggerDecisionDiagnostic,
  TriggerExpressionActualType,
} from './entities/diagnostic.js';
import type {TriggerSubscription} from './entities/subscription.js';

// Narrow the jsonb projection at the read boundary: the parser writes the right shapes,
// but the column is unconstrained and these values reach run inputs.

export function readConfigInputs(
  subscription: TriggerSubscription,
): Record<string, unknown> | undefined {
  const value = subscription.config.with;
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export type TriggerFilterEvaluation =
  | {kind: 'matched'}
  | {kind: 'filtered'}
  | {kind: 'filter-error'; reason: string; diagnostic: TriggerDecisionDiagnostic};

export type StoredFilterEvaluation = TriggerFilterEvaluation;

export interface EvaluateStoredFilterParams {
  value: unknown;
  context: Record<string, unknown>;
  invalidReason: string;
  evaluationFailedReason: string;
  invalidDiagnosticCode:
    | 'filter-config-invalid'
    | 'listener-snapshot-invalid'
    | 'listener-output-types-invalid';
}

export function evaluateStoredFilter(params: EvaluateStoredFilterParams): StoredFilterEvaluation {
  const {value} = params;
  if (value === null || value === undefined) return {kind: 'matched'};
  if (typeof value !== 'string' || value.trim() === '') {
    return {
      kind: 'filter-error',
      reason: params.invalidReason,
      diagnostic: {version: 1, code: params.invalidDiagnosticCode},
    };
  }

  let expression: WorkflowExpression;
  try {
    expression = createWorkflowExpression({source: value, check: {mode: 'syntax'}});
  } catch (error) {
    return {
      kind: 'filter-error',
      reason: safeSyntaxReason(error),
      diagnostic: syntaxDiagnostic(error),
    };
  }

  let evaluatedValue: unknown;
  try {
    evaluatedValue = evaluateWorkflowExpression(expression, params.context);
  } catch (error) {
    return {
      kind: 'filter-error',
      reason: params.evaluationFailedReason,
      diagnostic: evaluationDiagnostic(error),
    };
  }

  if (typeof evaluatedValue !== 'boolean') {
    return {
      kind: 'filter-error',
      reason: params.evaluationFailedReason,
      diagnostic: {
        version: 1,
        code: 'expression-result-not-boolean',
        actualType: expressionActualType(evaluatedValue),
      },
    };
  }

  return evaluatedValue ? {kind: 'matched'} : {kind: 'filtered'};
}

export interface EvaluateTriggerFilterParams {
  // Only `config.filter` is read; dev triggers evaluate through a subscription-
  // shaped adapter so replay uses the exact same path as dispatch.
  subscription: Pick<TriggerSubscription, 'config'>;
  source: string;
  event: string;
  payload: unknown;
}

export function evaluateTriggerFilter(
  params: EvaluateTriggerFilterParams,
): TriggerFilterEvaluation {
  return evaluateStoredFilter({
    value: params.subscription.config.filter,
    context: projectWorkflowPredicateContext('trigger.filter', {
      event: params.payload,
      trigger: {source: params.source, event: params.event},
    }),
    invalidReason: 'Trigger subscription filter must be a non-empty string when set',
    evaluationFailedReason: 'Trigger filter evaluation failed',
    invalidDiagnosticCode: 'filter-config-invalid',
  });
}

function syntaxDiagnostic(
  error: unknown,
): Extract<TriggerDecisionDiagnostic, {code: 'expression-syntax-invalid'}> {
  const cause = error instanceof InvalidWorkflowExpressionError ? error.cause : undefined;
  const offset = safeDiagnosticOffset(cause);
  return {
    version: 1,
    code: 'expression-syntax-invalid',
    summary: 'CEL parse failed',
    ...(offset === undefined ? {} : {offset}),
  };
}

function evaluationDiagnostic(error: unknown): TriggerDecisionDiagnostic {
  if (!(error instanceof WorkflowExpressionEvaluationError)) {
    return {version: 1, code: 'expression-evaluation-failed'};
  }

  switch (error.detail.kind) {
    case 'missing-path':
      return error.detail.path === undefined
        ? {version: 1, code: 'expression-evaluation-failed'}
        : {version: 1, code: 'expression-missing-path', path: error.detail.path};
    case 'index-out-of-bounds':
      return {
        version: 1,
        code: 'expression-index-out-of-bounds',
        index: error.detail.index,
        ...(error.detail.size === undefined ? {} : {size: error.detail.size}),
      };
    case 'evaluation-error':
      return {
        version: 1,
        code: 'expression-evaluation-failed',
        ...(error.detail.classification === undefined
          ? {}
          : {classification: error.detail.classification}),
      };
  }
}

function safeSyntaxReason(error: unknown): string {
  return syntaxDiagnostic(error).summary;
}

function safeDiagnosticOffset(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || !('range' in value)) return undefined;
  const range = value.range;
  if (typeof range !== 'object' || range === null || !('start' in range)) return undefined;
  return typeof range.start === 'number' && Number.isSafeInteger(range.start) && range.start >= 0
    ? range.start
    : undefined;
}

function expressionActualType(value: unknown): TriggerExpressionActualType {
  if (value === null) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'bigint') return 'int';
  if (typeof value === 'number') return 'double';
  if (Array.isArray(value) || value instanceof Set) return 'list';
  if (typeof value === 'object') return 'map';
  return 'unknown';
}
