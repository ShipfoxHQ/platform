export type WorkflowRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface TriggerContext {
  type: 'manual';
  [key: string]: unknown;
}

export interface WorkflowRun {
  id: string;
  workspaceId: string;
  projectId: string;
  definitionId: string;
  status: WorkflowRunStatus;
  triggerContext: TriggerContext;
  inputs: Record<string, unknown> | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
