export type TriggerEventOrigin = 'integration' | 'manual' | 'cron' | 'dev';

export type TriggerEventOutcome = 'received' | 'routed' | 'discarded' | 'failed' | 'errored';

export const triggerEventOutcomes = [
  'received',
  'routed',
  'discarded',
  'failed',
  'errored',
] as const satisfies readonly TriggerEventOutcome[];

export type TriggerEventDecisionOutcome =
  | 'triggered'
  | 'filtered'
  | 'filter-error'
  | 'dispatch-error'
  | 'rejected';

export type TriggerEventDecisionDiagnostic =
  | {version: 1; code: 'expression-missing-path'; path: string}
  | {
      version: 1;
      code: 'expression-index-out-of-bounds';
      index: number;
      size?: number | undefined;
    }
  | {
      version: 1;
      code: 'expression-syntax-invalid';
      summary: string;
      offset?: number | undefined;
    }
  | {
      version: 1;
      code: 'expression-evaluation-failed';
      classification?: string | undefined;
    }
  | {
      version: 1;
      code: 'expression-result-not-boolean';
      actualType: 'string' | 'int' | 'double' | 'null' | 'list' | 'map' | 'unknown';
    }
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
      envKey?: string | undefined;
    }
  | {version: 1; code: 'invalid-job-runner-labels'; labels: string[]}
  | {
      version: 1;
      code: 'source-snapshot-too-large';
      limitBytes: number;
      measuredBytes: number;
    }
  | {
      version: 1;
      code: 'diagnostic-too-large';
      field?: string | undefined;
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

export interface TriggerEventSource {
  provider: string | null;
  source: string;
}

export interface TriggerEventSummary extends TriggerEventSource {
  id: string;
  eventRef: string;
  origin: TriggerEventOrigin;
  workspaceId: string;
  event: string;
  deliveryId: string | null;
  connectionId: string | null;
  outcome: TriggerEventOutcome;
  matchedCount: number;
  receivedAt: string;
  processedAt: string | null;
  createdAt: string;
}

export interface TriggerEventMatchedWorkflowResult {
  id: string;
  subscriptionKind: 'trigger' | 'listener' | 'dev';
  subscriptionName: string;
  workflowDefinitionId: string | null;
  decision: TriggerEventDecisionOutcome;
  projectId: string | null;
  workflowRunId: string | null;
  jobId: string | null;
  matcherKind: 'on' | 'until' | null;
  matcherOrdinal: number | null;
  runId: string | null;
  runName: string | null;
  reason: string | null;
  diagnostic: TriggerEventDecisionDiagnostic | null;
}

export interface TriggerEventDetail extends TriggerEventSummary {
  connectionName: string | null;
  payload: Record<string, unknown> | null;
  processingDiagnostic: TriggerEventProcessingDiagnostic | null;
  decisions: TriggerEventMatchedWorkflowResult[];
}

export interface TriggerEventFacetItem {
  value: string;
  count: number;
}

export interface TriggerEventFacets {
  sources: TriggerEventFacetItem[];
  events: TriggerEventFacetItem[];
}

export interface TriggerEventListPage {
  events: TriggerEventSummary[];
  nextCursor: string | null;
}

export interface TriggerEventFilters {
  source?: string[] | undefined;
  event?: string[] | undefined;
  origin?: TriggerEventOrigin[] | undefined;
  outcome?: TriggerEventOutcome[] | undefined;
  from?: string | undefined;
  to?: string | undefined;
  /** Only events a dev run can replay (integration origin with a stored payload). */
  replayable?: boolean | undefined;
}

export function normalizeTriggerEventFilterValues(
  values: readonly string[] | undefined,
): string[] | null {
  return values && values.length > 0 ? [...new Set(values)].sort() : null;
}

export function normalizeTriggerEventFilters(filters: TriggerEventFilters) {
  return {
    source: normalizeTriggerEventFilterValues(filters.source),
    event: normalizeTriggerEventFilterValues(filters.event),
    origin: normalizeTriggerEventFilterValues(filters.origin),
    outcome: normalizeTriggerEventFilterValues(filters.outcome),
    from: filters.from ?? null,
    to: filters.to ?? null,
    replayable: filters.replayable ? true : null,
  };
}

export function hasTriggerEventFilters(filters: TriggerEventFilters): boolean {
  const normalized = normalizeTriggerEventFilters(filters);
  return Boolean(
    normalized.source ||
      normalized.event ||
      normalized.origin ||
      normalized.outcome ||
      normalized.from ||
      normalized.to ||
      normalized.replayable,
  );
}

export type TriggerEventResultKind = 'triggered' | 'no-match' | 'failed' | 'evaluating';

export interface TriggerEventResult {
  kind: TriggerEventResultKind;
  matchedWorkflowCount: number;
  isFailure: boolean;
}

export function getTriggerEventResult(
  event: Pick<TriggerEventSummary, 'outcome' | 'matchedCount'>,
): TriggerEventResult {
  switch (event.outcome) {
    case 'routed':
      return {kind: 'triggered', matchedWorkflowCount: event.matchedCount, isFailure: false};
    case 'discarded':
      return {kind: 'no-match', matchedWorkflowCount: 0, isFailure: false};
    case 'failed':
    case 'errored':
      return {kind: 'failed', matchedWorkflowCount: event.matchedCount, isFailure: true};
    case 'received':
      return {kind: 'evaluating', matchedWorkflowCount: 0, isFailure: false};
  }
}

export const triggerEventResultFilterOutcomes = {
  triggered: ['routed'],
  'no-match': ['discarded'],
  failed: ['failed', 'errored'],
  evaluating: ['received'],
} as const satisfies Record<TriggerEventResultKind, readonly TriggerEventOutcome[]>;
