export interface IntegrationConnectionRepositoryGrant {
  id: string;
  connectionId: string;
  workspaceId: string;
  externalRepositoryId: string;
  repositoryOwner: string;
  repositoryName: string;
  createdAt: Date;
  updatedAt: Date;
}
