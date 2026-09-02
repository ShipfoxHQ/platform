import type {Environment} from '@marcbachmann/cel-js';
import type {WorkflowExpression} from '../expression/workflow-expression.js';
import {WorkflowExpressionEvaluationError} from './errors.js';
import {createWorkflowEnvironment} from './workflow-environment.js';

export type WorkflowExpressionEvaluationContext = Readonly<Record<string, unknown>>;
export type WorkflowExpressionEvaluationValue = unknown;
export type WorkflowExpressionEnvironment = Pick<Environment, 'evaluate'>;

const workflowEnvironment = createWorkflowEnvironment();

export function evaluateWorkflowExpression(
  expression: WorkflowExpression,
  context: WorkflowExpressionEvaluationContext,
): WorkflowExpressionEvaluationValue {
  try {
    return workflowEnvironment.evaluate(expression.source, context);
  } catch (error) {
    throw new WorkflowExpressionEvaluationError(error);
  }
}

/**
 * Evaluate an expression against a caller-owned CEL environment.
 *
 * The caller-owned environment can provide a narrower or broader function set
 * when the shared workflow registry is not the right boundary.
 */
export function evaluateWorkflowExpressionWithEnvironment(
  expression: WorkflowExpression,
  context: WorkflowExpressionEvaluationContext,
  environment: WorkflowExpressionEnvironment,
): WorkflowExpressionEvaluationValue {
  try {
    return environment.evaluate(expression.source, context);
  } catch (error) {
    throw new WorkflowExpressionEvaluationError(error);
  }
}

export function evaluateWorkflowPredicate(
  expression: WorkflowExpression,
  context: WorkflowExpressionEvaluationContext,
): boolean {
  const value = evaluateWorkflowExpression(expression, context);
  if (typeof value !== 'boolean') {
    throw new WorkflowExpressionEvaluationError(
      new TypeError(`Workflow predicate must evaluate to a boolean; got ${typeof value}.`),
    );
  }
  return value;
}

export interface FailClosedPredicateOutcome {
  readonly value: boolean;
  readonly evaluationFailed: boolean;
}

export function evaluateWorkflowPredicateFailClosed(
  expression: WorkflowExpression,
  context: WorkflowExpressionEvaluationContext,
): FailClosedPredicateOutcome {
  try {
    return {value: evaluateWorkflowPredicate(expression, context), evaluationFailed: false};
  } catch (error) {
    if (error instanceof WorkflowExpressionEvaluationError) {
      return {value: false, evaluationFailed: true};
    }
    throw error;
  }
}
