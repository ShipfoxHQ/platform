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
  | 'filter-error'
  | 'dispatch-error'
  | 'rejected';

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
  subscriptionName: string;
  decision: TriggerEventDecisionOutcome;
  projectId: string | null;
  runId: string | null;
  runName: string | null;
  reason: string | null;
}

export interface TriggerEventDetail extends TriggerEventSummary {
  connectionName: string | null;
  payload: Record<string, unknown> | null;
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
