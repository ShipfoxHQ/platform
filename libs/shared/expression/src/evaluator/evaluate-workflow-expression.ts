import {type Environment, evaluate} from '@marcbachmann/cel-js';
import type {WorkflowExpression} from '../expression/workflow-expression.js';
import {WorkflowExpressionEvaluationError} from './errors.js';

export type WorkflowExpressionEvaluationContext = Readonly<Record<string, unknown>>;
export type WorkflowExpressionEvaluationValue = unknown;
export type WorkflowExpressionEnvironment = Pick<Environment, 'evaluate'>;

export function evaluateWorkflowExpression(
  expression: WorkflowExpression,
  context: WorkflowExpressionEvaluationContext,
): WorkflowExpressionEvaluationValue {
  try {
    return evaluate(expression.source, context);
  } catch (error) {
    throw new WorkflowExpressionEvaluationError(error);
  }
}

/**
 * Evaluate an expression against a caller-owned CEL environment.
 *
 * Workflow expressions deliberately continue to use the global CEL evaluator.
 * Callers that need custom functions, such as config templating, must opt in
 * by creating and passing their own environment.
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
  return evaluateWorkflowExpression(expression, context) === true;
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
