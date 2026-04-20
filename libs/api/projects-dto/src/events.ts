export const PROJECT_CREATED = 'projects.project.created' as const;
export const PROJECT_VCS_BOUND = 'projects.project.vcs_bound' as const;

export interface ProjectCreatedEvent {
  actorId: string;
  workspaceId: string;
  projectId: string;
  repositoryId: string;
}

export interface ProjectVcsBoundEvent {
  actorId: string;
  workspaceId: string;
  projectId: string;
  repositoryId: string;
  provider: 'test' | 'github' | 'gitlab';
  providerHost: string;
  externalRepositoryId: string;
}

export interface ProjectsEventMap {
  [PROJECT_CREATED]: ProjectCreatedEvent;
  [PROJECT_VCS_BOUND]: ProjectVcsBoundEvent;
}
