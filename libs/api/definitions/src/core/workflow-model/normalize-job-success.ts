import {DEFAULT_JOB_SUCCESS} from '@shipfox/api-definitions-dto';
import type {ExpressionTypeEnvironment} from '@shipfox/expression';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {validatePredicateExpression} from './validate-predicate-expression.js';

export {DEFAULT_JOB_SUCCESS};

export function normalizeJobSuccess(params: {
  source: string | undefined;
  sourceName: string;
  issues: WorkflowModelValidationIssue[];
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
}): string | undefined {
  if (params.source === undefined) return undefined;

  const expression = validatePredicateExpression({
    field: 'job.success',
    source: params.source,
    path: ['jobs', params.sourceName, 'success'],
    invalidCode: 'invalid-job-success',
    invalidMessage: 'Job success must be a valid CEL boolean expression.',
    issues: params.issues,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
  });
  return expression?.source;
}
