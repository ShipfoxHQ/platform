import {InvalidWorkflowTemplateError, parseWorkflowTemplate} from '@shipfox/expression';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {issue} from './validation-issue.js';

/** Defense-in-depth for typed callers that bypass workflowDocumentSchema. */
export function validateLiteralName(params: {
  field: 'workflow.name' | 'job.name';
  dynamicField: 'run_name' | 'execution_name';
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  message: string;
  issues: WorkflowModelValidationIssue[];
}): void {
  try {
    const segments = parseWorkflowTemplate(params.source);
    if (!segments.some((segment) => segment.kind === 'expr')) return;
  } catch (error) {
    params.issues.push(
      literalNameIssue({
        ...params,
        reason:
          error instanceof InvalidWorkflowTemplateError
            ? error.reason
            : 'Template source did not parse.',
      }),
    );
    return;
  }

  params.issues.push(
    literalNameIssue({
      ...params,
      reason: `Static names cannot contain interpolation expressions. Use ${params.dynamicField} for runtime interpolation.`,
    }),
  );
}

export function unescapeLiteralName(source: string): string {
  return source.replaceAll('$${{', '${{');
}

function literalNameIssue(params: {
  field: 'workflow.name' | 'job.name';
  dynamicField: 'run_name' | 'execution_name';
  source: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  message: string;
  reason: string;
}): WorkflowModelValidationIssue {
  return issue({
    code: 'invalid-interpolation-template',
    message: params.message,
    path: params.path,
    details: {
      field: params.field,
      source: params.source,
      dynamicField: params.dynamicField,
      reason: params.reason,
    },
  });
}
