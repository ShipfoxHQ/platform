export type WorkspaceStatus = 'active' | 'suspended' | 'deleted';

export interface Workspace {
  id: string;
  name: string;
  status: WorkspaceStatus;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
