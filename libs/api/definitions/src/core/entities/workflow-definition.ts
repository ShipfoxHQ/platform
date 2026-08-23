import type {WorkflowModel, WorkflowSourceSnapshot} from '@shipfox/api-definitions-dto';
import type {WorkflowDocument} from '@shipfox/workflow-document';

export type {WorkflowSourceSnapshot};

export type WorkflowSpec = WorkflowDocument;

export interface WorkflowDefinitionPayload {
  document: WorkflowDocument;
  model: WorkflowModel;
  sourceSnapshot?: WorkflowSourceSnapshot | null;
}

export interface WorkflowDefinition {
  id: string;
  /** Workflow lineage id: stable identity per (projectId, configPath). */
  workflowId: string;
  projectId: string;
  configPath: string | null;
  source: 'manual' | 'vcs';
  sha: string | null;
  ref: string | null;
  name: string;
  /**
   * Compatibility alias for packages that still consume the authoring document
   * before they migrate to `document`/`model`.
   */
  definition: WorkflowSpec;
  document: WorkflowDocument;
  model: WorkflowModel;
  sourceSnapshot: WorkflowSourceSnapshot | null;
  contentHash: string | null;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
