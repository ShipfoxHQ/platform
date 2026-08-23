export interface TriggerSubscription {
  id: string;
  workspaceId: string;
  projectId: string;
  workflowDefinitionId: string;
  name: string;
  source: string;
  /** NULL is a source subscription: matches every event the source delivers. */
  event: string | null;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
