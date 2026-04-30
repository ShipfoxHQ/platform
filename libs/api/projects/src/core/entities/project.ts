export interface Project {
  id: string;
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}
