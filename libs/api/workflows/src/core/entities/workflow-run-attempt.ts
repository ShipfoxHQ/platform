import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import type {AgentToolMaterializationSnapshot} from '#core/agent-tools.js';
import type {WorkflowRunStatus} from './workflow-run.js';

export type RerunMode = 'all' | 'failed';

export interface WorkflowRunAttempt {
  id: string;
  workflowRunId: string;
  attempt: number;
  status: WorkflowRunStatus;
  rerunMode: RerunMode | null;
  rerunByUserId: string | null;
  model: WorkflowModel | null;
  vars: Record<string, string> | null;
  agentToolMaterialization: AgentToolMaterializationSnapshot | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}
