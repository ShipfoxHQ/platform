import {Factory} from 'fishery';

interface Project {
  id: string;
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  sourceRepositoryOwner: string | null;
  sourceRepositoryName: string | null;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export const projectFactory = Factory.define<Project>(({sequence}) => ({
  id: crypto.randomUUID(),
  workspaceId: crypto.randomUUID(),
  sourceConnectionId: crypto.randomUUID(),
  sourceExternalRepositoryId: `acme/repo-${sequence}`,
  sourceRepositoryOwner: 'acme',
  sourceRepositoryName: `repo-${sequence}`,
  name: `Project ${sequence}`,
  createdAt: new Date(),
  updatedAt: new Date(),
}));
