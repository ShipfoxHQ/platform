import {
  evaluateWorkflowPredicateFailClosed,
  type FailClosedPredicateOutcome,
  type WorkflowExpressionEvaluationContext,
} from '../evaluator/evaluate-workflow-expression.js';
import type {WorkflowExpression} from '../expression/workflow-expression.js';
import type {
  AvailabilitySite,
  FillTarget,
  WorkflowPredicateField,
} from '../workflow-context/workflow-context.js';
import {
  getWorkflowPredicateFieldMinimumFillTarget,
  projectWorkflowPredicateContext,
} from '../workflow-context/workflow-context.js';
import {shouldFillAtSite} from './fill.js';
import {type RoutedExpression, routeExpression} from './route-expression.js';

export interface PlannedPredicateEvaluationResult extends FailClosedPredicateOutcome {
  readonly route: RoutedExpression;
}

export function evaluatePlannedPredicateAtSite(params: {
  readonly expression: WorkflowExpression;
  readonly field: WorkflowPredicateField;
  readonly site: AvailabilitySite;
  readonly context: WorkflowExpressionEvaluationContext;
}): PlannedPredicateEvaluationResult {
  const route = routePredicateExpression(params.expression, params.field);
  if (!shouldFillAtSite(route.fillTarget, params.site)) {
    return {value: false, evaluationFailed: true, route};
  }

  return {
    ...evaluateWorkflowPredicateFailClosed(
      params.expression,
      projectWorkflowPredicateContext(params.field, params.context),
    ),
    route,
  };
}

function routePredicateExpression(
  expression: WorkflowExpression,
  field: WorkflowPredicateField,
): RoutedExpression {
  const route = routeExpression(expression);
  return {
    ...route,
    fillTarget: laterFillTarget(
      route.fillTarget,
      getWorkflowPredicateFieldMinimumFillTarget(field),
    ),
  };
}

function laterFillTarget(left: FillTarget, right: AvailabilitySite): FillTarget {
  if (left === 'runner-fill') return left;
  return shouldFillAtSite(right, left) ? left : right;
}
