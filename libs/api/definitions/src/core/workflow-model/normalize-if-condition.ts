import {
  type ExpressionTypeEnvironment,
  extractExactContextRoots,
  InvalidWorkflowTemplateError,
  parseWorkflowTemplate,
  type WorkflowExpression,
  type WorkflowPredicateField,
  type WorkflowTemplateExprSegment,
} from '@shipfox/expression';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssueCode,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {validatePredicateExpression} from './validate-predicate-expression.js';
import {issue} from './validation-issue.js';
import {workflowFieldLabel} from './workflow-field-label.js';

const ifExpressionSyntax = `\${{ }}`;

export function normalizeIfCondition(params: {
  readonly field: Extract<WorkflowPredicateField, 'job.if' | 'step.if'>;
  readonly source: string | undefined;
  readonly path: readonly WorkflowModelValidationIssuePathSegment[];
  readonly invalidCode: Extract<
    WorkflowModelValidationIssueCode,
    'invalid-job-if' | 'invalid-step-if'
  >;
  readonly invalidMessage: string;
  readonly issues: WorkflowModelValidationIssue[];
  readonly allowedJobReferences: ReadonlySet<string>;
  readonly typeOverlay: ExpressionTypeEnvironment;
}): WorkflowExpression | undefined {
  if (params.source === undefined) return undefined;
  const source = params.source;

  const expressionSegment = parseSingleExpression({...params, source});
  if (expressionSegment === undefined) return undefined;

  const roots = extractExactContextRoots(expressionSegment.expression.source);
  if (roots.includes('needs') && params.allowedJobReferences.size === 0) {
    params.issues.push(
      issue({
        code: params.invalidCode,
        message: `${workflowFieldLabel(params.field)} cannot reference needs because the job has no direct needs.`,
        path: params.path,
        details: {
          field: params.field,
          source: params.source,
          contextRoots: roots,
          rejectedRoots: ['needs'],
        },
      }),
    );
    return undefined;
  }

  return validatePredicateExpression({
    field: params.field,
    source: expressionSegment.expression.source,
    path: params.path,
    invalidCode: params.invalidCode,
    invalidMessage: params.invalidMessage,
    issues: params.issues,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
  });
}

function parseSingleExpression(params: {
  readonly field: WorkflowPredicateField;
  readonly source: string;
  readonly path: readonly WorkflowModelValidationIssuePathSegment[];
  readonly invalidCode: WorkflowModelValidationIssueCode;
  readonly invalidMessage: string;
  readonly issues: WorkflowModelValidationIssue[];
}): WorkflowTemplateExprSegment | undefined {
  let segments: ReturnType<typeof parseWorkflowTemplate>;
  try {
    segments = parseWorkflowTemplate(params.source);
  } catch (error) {
    params.issues.push(
      invalidIfIssue({
        ...params,
        reason:
          error instanceof InvalidWorkflowTemplateError
            ? error.reason
            : 'Template source did not parse.',
      }),
    );
    return undefined;
  }

  const [segment] = segments;
  if (segment?.kind === 'expr' && segments.length === 1) return segment;

  params.issues.push(
    invalidIfIssue({
      ...params,
      reason: `${workflowFieldLabel(params.field)} must be exactly one ${ifExpressionSyntax} expression.`,
    }),
  );
  return undefined;
}

function invalidIfIssue(params: {
  readonly field: WorkflowPredicateField;
  readonly source: string;
  readonly path: readonly WorkflowModelValidationIssuePathSegment[];
  readonly invalidCode: WorkflowModelValidationIssueCode;
  readonly invalidMessage: string;
  readonly reason: string;
}): WorkflowModelValidationIssue {
  return issue({
    code: params.invalidCode,
    message: params.invalidMessage,
    path: params.path,
    details: {
      field: params.field,
      source: params.source,
      reason: params.reason,
    },
  });
}
