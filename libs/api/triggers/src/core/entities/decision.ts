import type {TriggerDecisionDiagnostic} from './diagnostic.js';
import type {JobListenerMatcherKind} from './job-listener-subscription.js';

export const triggerDecisionOutcomes = [
  'triggered',
  'filtered',
  'filter-error',
  'dispatch-error',
  'rejected',
] as const;
export type TriggerDecisionOutcome = (typeof triggerDecisionOutcomes)[number];
export type TriggerDecisionSubscriptionKind = 'trigger' | 'listener' | 'dev';

export interface TriggerDecision {
  id: string;
  receivedEventId: string;
  subscriptionKind: TriggerDecisionSubscriptionKind;
  /** Null for `dev` decisions: a dev journal entry has no subscription row. */
  subscriptionId: string | null;
  subscriptionName: string;
  workflowDefinitionId: string | null;
  projectId: string | null;
  workflowRunId: string | null;
  jobId: string | null;
  matcherKind: JobListenerMatcherKind | null;
  matcherOrdinal: number | null;
  decision: TriggerDecisionOutcome;
  runId: string | null;
  runName: string | null;
  reason: string | null;
  diagnostic?: TriggerDecisionDiagnostic | null;
  createdAt: Date;
}
