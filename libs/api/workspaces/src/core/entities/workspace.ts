export type WorkspaceStatus = 'active' | 'suspended' | 'deleted';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  status: WorkspaceStatus;
  settings: Record<string, unknown>;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}
