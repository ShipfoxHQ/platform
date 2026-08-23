export type JobListenerMatcherKind = 'on' | 'until';

export interface JobListenerSubscription {
  id: string;
  workspaceId: string;
  workflowRunId: string;
  jobId: string;
  kind: JobListenerMatcherKind;
  matcherOrdinal: number;
  source: string;
  /** NULL is a source subscription: matches every event the source delivers. */
  event: string | null;
  config: Record<string, unknown>;
  createdAt: Date;
}
