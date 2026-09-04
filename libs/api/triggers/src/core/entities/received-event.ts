export const triggerEventOrigins = ['integration', 'manual', 'cron', 'dev'] as const;
export type TriggerEventOrigin = (typeof triggerEventOrigins)[number];

export const triggerEventOutcomes = [
  'received',
  'routed',
  'discarded',
  'failed',
  'errored',
] as const;
export type TriggerEventOutcome = (typeof triggerEventOutcomes)[number];

export interface TriggerReceivedEvent {
  id: string;
  eventRef: string;
  origin: TriggerEventOrigin;
  workspaceId: string;
  provider: string | null;
  source: string;
  event: string;
  /** The source event this entry replays, when origin is `dev`. */
  replayOfEventId: string | null;
  deliveryId: string | null;
  connectionId: string | null;
  connectionName: string | null;
  outcome: TriggerEventOutcome;
  matchedCount: number;
  payload: Record<string, unknown> | null;
  processingDiagnostic?: TriggerEventProcessingDiagnostic | null;
  receivedAt: Date;
  processedAt: Date | null;
  createdAt: Date;
}

/**
 * A dev journal entry that replayed a source event. A missing run ID means
 * that the replay has no recorded workflow run, including refusals and an
 * incomplete or failed dev decision write.
 */
export interface TriggerEventReplay {
  id: string;
  receivedAt: Date;
  outcome: TriggerEventOutcome;
  runId: string | null;
}

/**
 * Trigger event shape for list read models.
 * It omits payload and processing diagnostics. Webhook bodies can be large or
 * untrusted, and only detail views render diagnostics.
 */
export type TriggerReceivedEventSummary = Omit<
  TriggerReceivedEvent,
  'payload' | 'processingDiagnostic'
>;

import type {TriggerEventProcessingDiagnostic} from './diagnostic.js';
