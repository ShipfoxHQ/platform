export interface Project {
  id: string;
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  sourceRepositoryOwner: string | null;
  sourceRepositoryName: string | null;
  sourceDefaultBranch: string | null;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}
