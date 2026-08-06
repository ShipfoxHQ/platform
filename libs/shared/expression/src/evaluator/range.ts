import type {WorkflowExpressionEnvironment} from './evaluate-workflow-expression.js';
import {createWorkflowEnvironment} from './workflow-environment.js';

export {MAX_RANGE_ELEMENTS} from '../workflow-function-registry.js';

/** Create a workflow evaluator with the shared CEL function registry. */
export function createRangeEnvironment(): WorkflowExpressionEnvironment {
  return createWorkflowEnvironment();
}
