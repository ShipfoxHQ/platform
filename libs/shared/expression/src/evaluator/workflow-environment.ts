import {type Context, Environment} from '@marcbachmann/cel-js';
import {registerWorkflowFunctions} from '../workflow-function-registry.js';
import type {WorkflowExpressionEnvironment} from './evaluate-workflow-expression.js';

export function createWorkflowEnvironment(): WorkflowExpressionEnvironment {
  // Building the CEL environment once and resetting the budget keeps the
  // per-evaluation materialization limit while avoiding a rebuild per call.
  const environment = new Environment({unlistedVariablesAreDyn: true});
  const budgets = registerWorkflowFunctions(environment);

  return {
    evaluate(expression: string, context?: Context) {
      return budgets.isolate(context, () => environment.evaluate(expression, context));
    },
  };
}
