import {
  createWorkflowExpression,
  evaluateWorkflowPredicateFailClosed,
  InvalidWorkflowExpressionError,
  projectWorkflowPredicateContext,
  type WorkflowExpression,
} from '@shipfox/expression';
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
  | {kind: 'filter-error'; reason: string};

export type StoredFilterEvaluation = TriggerFilterEvaluation;

export interface EvaluateStoredFilterParams {
  value: unknown;
  context: Record<string, unknown>;
  invalidReason: string;
  evaluationFailedReason: string;
}

export function evaluateStoredFilter(params: EvaluateStoredFilterParams): StoredFilterEvaluation {
  const {value} = params;
  if (value === null || value === undefined) return {kind: 'matched'};
  if (typeof value !== 'string' || value.trim() === '') {
    return {
      kind: 'filter-error',
      reason: params.invalidReason,
    };
  }

  let expression: WorkflowExpression;
  try {
    expression = createWorkflowExpression({source: value, check: {mode: 'syntax'}});
  } catch (error) {
    return {kind: 'filter-error', reason: reasonFrom(error)};
  }

  const result = evaluateWorkflowPredicateFailClosed(expression, params.context);

  if (result.evaluationFailed) {
    return {kind: 'filter-error', reason: params.evaluationFailedReason};
  }

  return result.value ? {kind: 'matched'} : {kind: 'filtered'};
}

export interface EvaluateTriggerFilterParams {
  subscription: TriggerSubscription;
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
  });
}

function reasonFrom(error: unknown): string {
  if (error instanceof InvalidWorkflowExpressionError) return error.reason;
  if (error instanceof Error) return error.message;
  return String(error);
}
