export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = 'ProjectNotFoundError';
  }
}

export class ProjectAccessDeniedError extends Error {
  constructor(projectId: string) {
    super(`Access denied for project: ${projectId}`);
    this.name = 'ProjectAccessDeniedError';
  }
}

export class ProjectAlreadyExistsError extends Error {
  constructor(
    public readonly existingProjectId: string,
    public readonly sourceConnectionId: string,
    public readonly sourceExternalRepositoryId: string,
  ) {
    super(
      `Project already exists for source repository: ${sourceConnectionId}/${sourceExternalRepositoryId}`,
    );
    this.name = 'ProjectAlreadyExistsError';
  }
}
