export const PROJECT_CREATED = 'projects.project.created' as const;
export const PROJECT_SOURCE_BOUND = 'projects.project.source_bound' as const;

export interface ProjectCreatedEvent {
  actorId: string;
  workspaceId: string;
  projectId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
}

export interface ProjectSourceBoundEvent {
  actorId: string;
  workspaceId: string;
  projectId: string;
  sourceConnectionId: string;
  provider: 'debug' | 'github';
  externalRepositoryId: string;
}

export interface ProjectsEventMap {
  [PROJECT_CREATED]: ProjectCreatedEvent;
  [PROJECT_SOURCE_BOUND]: ProjectSourceBoundEvent;
}
