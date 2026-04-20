export const WORKFLOW_RUN_CREATED = 'workflows.run.created' as const;
export const WORKFLOW_RUN_FINISHED = 'workflows.run.finished' as const;

export interface WorkflowRunCreatedEvent {
  runId: string;
  workspaceId: string;
  projectId: string;
  definitionId: string;
}

export interface WorkflowRunFinishedEvent {
  runId: string;
  projectId: string;
  status: 'succeeded' | 'failed' | 'cancelled';
}

export interface WorkflowsEventMap {
  [WORKFLOW_RUN_CREATED]: WorkflowRunCreatedEvent;
  [WORKFLOW_RUN_FINISHED]: WorkflowRunFinishedEvent;
}
