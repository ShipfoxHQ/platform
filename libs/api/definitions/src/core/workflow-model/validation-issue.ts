import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssueCode,
  WorkflowModelValidationIssuePathSegment,
  WorkflowModelValidationIssueScope,
  WorkflowModelValidationIssueSeverity,
} from './invalid-workflow-model-error.js';

export function issue(params: {
  code: WorkflowModelValidationIssueCode;
  message: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  details?: Readonly<Record<string, unknown>>;
  severity?: WorkflowModelValidationIssueSeverity;
  scope?: WorkflowModelValidationIssueScope;
}): WorkflowModelValidationIssue {
  const severity = params.severity ?? 'error';
  const scope = params.scope ?? 'definition';
  const base = {code: params.code, message: params.message, path: params.path, severity, scope};

  if (params.details === undefined) {
    return base;
  }

  return {...base, details: params.details};
}
