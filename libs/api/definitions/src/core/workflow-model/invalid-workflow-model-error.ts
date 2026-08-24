export const invalidWorkflowModelErrorCode = 'invalid-workflow-model';

export type WorkflowModelValidationIssueCode =
  | 'context-unavailable-at-fill-site'
  | 'dynamic-name-self-reference'
  | 'context-unavailable-at-predicate-site'
  | 'computed-context-key'
  | 'checkout-target-invalid'
  | 'duplicate-job-id'
  | 'duplicate-step-id'
  | 'duplicate-trigger-id'
  | 'harness-provider-incompatible'
  | 'harness-thinking-incompatible'
  | 'harness-tool-incompatible'
  | 'integration-connection-not-capable'
  | 'integration-connection-not-found'
  | 'integration-write-not-allowed'
  | 'invalid-cron-schedule'
  | 'invalid-cron-timezone'
  | 'invalid-provider'
  | 'invalid-trigger-event'
  | 'invalid-trigger-filter'
  | 'invalid-interpolation-expression'
  | 'invalid-interpolation-template'
  | 'invalid-duration'
  | 'invalid-listener-filter'
  | 'invalid-model'
  | 'invalid-job-if'
  | 'invalid-job-success'
  | 'invalid-output-schema'
  | 'invalid-runner-label'
  | 'invalid-agent-session-key'
  | 'invalid-step-gate-restart-from'
  | 'invalid-step-gate-success'
  | 'invalid-step-if'
  | 'job-dependency-cycle'
  | 'listening-job-missing-resolution-source'
  | 'listening-job-no-active-matcher'
  | 'listening-timeout-exceeds-run-timeout'
  | 'missing-harness-for-tools'
  | 'missing-connection-for-integration'
  | 'missing-job-needs-edge'
  | 'missing-cron-schedule'
  | 'missing-runner-label'
  | 'multiple-manual-triggers'
  | 'runner-context-not-bare'
  | 'runner-context-in-field'
  | 'runner-context-in-server-predicate'
  | 're-evaluating-command'
  | 'self-job-dependency'
  | 'too-many-runner-labels'
  | 'tool-step-ambiguous-selector'
  | 'tool-step-missing-connection'
  | 'tool-step-sensitive-tool'
  | 'tool-with-max-depth-exceeded'
  | 'unknown-secret-store'
  | 'unknown-interpolation-context'
  | 'unknown-trigger-event'
  | 'unknown-trigger-source'
  | 'unknown-integration-method'
  | 'unknown-integration-tool'
  | 'unknown-job-dependency'
  | 'untrusted-agent-selection-context';

export type WorkflowModelValidationIssuePathSegment = string | number;

export type WorkflowModelValidationIssueSeverity = 'error' | 'warning';

export type WorkflowModelValidationIssueScope = 'definition' | 'trigger';

export interface WorkflowModelValidationIssue {
  readonly code: WorkflowModelValidationIssueCode;
  readonly message: string;
  readonly path: readonly WorkflowModelValidationIssuePathSegment[];
  readonly details?: Readonly<Record<string, unknown>>;
  readonly severity: WorkflowModelValidationIssueSeverity;
  readonly scope: WorkflowModelValidationIssueScope;
}

export class InvalidWorkflowModelError extends Error {
  readonly code = invalidWorkflowModelErrorCode;

  constructor(readonly issues: readonly WorkflowModelValidationIssue[]) {
    super('Invalid workflow model');
    this.name = 'InvalidWorkflowModelError';
  }
}
