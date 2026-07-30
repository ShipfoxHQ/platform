import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssueCode,
  WorkflowModelValidationIssuePathSegment,
  WorkflowModelValidationIssueSeverity,
} from './invalid-workflow-model-error.js';

export function issue(params: {
  code: WorkflowModelValidationIssueCode;
  message: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  details?: Readonly<Record<string, unknown>>;
  severity?: WorkflowModelValidationIssueSeverity;
}): WorkflowModelValidationIssue {
  if (params.details === undefined) {
    return {
      code: params.code,
      message: params.message,
      path: params.path,
      ...(params.severity === undefined ? {} : {severity: params.severity}),
    };
  }

  return {
    code: params.code,
    message: params.message,
    path: params.path,
    details: params.details,
    ...(params.severity === undefined ? {} : {severity: params.severity}),
  };
}
