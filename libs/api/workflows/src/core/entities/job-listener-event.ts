import type {WorkflowRunTriggerReference} from './workflow-run.js';

export type JobListenerEventDisposition = 'fire' | 'resolve';

export type JobListenerEventOutcome = 'pending' | 'consumed' | 'honored' | 'rejected' | 'abandoned';

export type JobListenerEventOutcomeReason =
  | 'payload_too_large'
  | 'until'
  | 'timeout'
  | 'max_executions'
  | 'cancelled';

export interface JobListenerEvent {
  id: string;
  jobId: string;
  disposition: JobListenerEventDisposition;
  eventRef: string;
  deliveryId: string;
  source: string;
  event: string;
  triggerReference: WorkflowRunTriggerReference | null;
  outcome: JobListenerEventOutcome;
  outcomeReason: JobListenerEventOutcomeReason | null;
  payload: unknown;
  storedPayloadBytes: number;
  normalizedEventBytes: number;
  receivedAt: Date;
  consumedByExecutionId: string | null;
  createdAt: Date;
}
