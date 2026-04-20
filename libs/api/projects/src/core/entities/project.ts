import type {Repository} from './repository.js';

export interface Project {
  id: string;
  workspaceId: string;
  repositoryId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectWithRepository extends Project {
  repository: Repository;
}
