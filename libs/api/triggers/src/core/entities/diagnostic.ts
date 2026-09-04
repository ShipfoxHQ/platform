export type TriggerExpressionActualType =
  | 'string'
  | 'int'
  | 'double'
  | 'null'
  | 'list'
  | 'map'
  | 'unknown';

export type TriggerDecisionDiagnostic =
  | {version: 1; code: 'expression-missing-path'; path: string}
  | {version: 1; code: 'expression-index-out-of-bounds'; index: number; size?: number}
  | {version: 1; code: 'expression-syntax-invalid'; summary: string; offset?: number}
  | {version: 1; code: 'expression-evaluation-failed'; classification?: string}
  | {version: 1; code: 'expression-result-not-boolean'; actualType: TriggerExpressionActualType}
  | {
      version: 1;
      code: 'filter-config-invalid' | 'listener-snapshot-invalid' | 'listener-output-types-invalid';
    }
  | {
      version: 1;
      code:
        | 'admission-denied'
        | 'workspace-not-found'
        | 'workspace-suspended'
        | 'workspace-deleted'
        | 'definition-not-found'
        | 'project-mismatch'
        | 'agent-config-unresolvable'
        | 'agent-integration-materialization-failed';
    }
  | {
      version: 1;
      code: 'interpolation-unresolvable';
      field: string;
      envKey?: string;
    }
  | {version: 1; code: 'invalid-job-runner-labels'; labels: string[]}
  | {
      version: 1;
      code: 'source-snapshot-too-large' | 'diagnostic-too-large';
      field?: string;
      limitBytes: number;
      measuredBytes: number;
    }
  | {
      version: 1;
      code: 'workflow-execution-payload-too-large';
      field: string;
      limitBytes: number;
      measuredBytes: number;
      overshootBytes: number;
    }
  | {
      version: 1;
      code: 'listener-event-payload-too-large';
      limitBytes: number;
      measuredBytes: number;
      overshootBytes: number;
    }
  | {
      version: 1;
      code: 'unexpected-workflow-start-failure' | 'unexpected-listener-delivery-failure';
    };

export interface TriggerEventProcessingDiagnostic {
  version: 1;
  code:
    | 'subscription-load-failed'
    | 'trigger-reference-resolution-failed'
    | 'listener-routing-failed'
    | 'event-processing-failed';
}
