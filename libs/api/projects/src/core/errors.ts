export class VcsConnectionNotFoundError extends Error {
  constructor(vcsConnectionId: string) {
    super(`VCS connection not found: ${vcsConnectionId}`);
    this.name = 'VcsConnectionNotFoundError';
  }
}

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
    public readonly repositoryId: string,
  ) {
    super(`Project already exists for repository: ${repositoryId}`);
    this.name = 'ProjectAlreadyExistsError';
  }
}

export class TestVcsProviderDisabledError extends Error {
  constructor() {
    super('Test VCS provider is disabled.');
    this.name = 'TestVcsProviderDisabledError';
  }
}

export type VcsProviderErrorReason =
  | 'repository-not-found'
  | 'access-denied'
  | 'timeout'
  | 'rate-limited'
  | 'provider-unavailable'
  | 'malformed-provider-response';

export class VcsProviderError extends Error {
  constructor(
    public readonly reason: VcsProviderErrorReason,
    message: string,
    public readonly retryAfterSeconds?: number | undefined,
  ) {
    super(message);
    this.name = 'VcsProviderError';
  }
}
