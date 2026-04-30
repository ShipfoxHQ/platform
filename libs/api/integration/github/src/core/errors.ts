export type GithubIntegrationProviderErrorReason =
  | 'repository-not-found'
  | 'access-denied'
  | 'rate-limited'
  | 'timeout'
  | 'provider-unavailable'
  | 'malformed-provider-response';

export class GithubIntegrationProviderError extends Error {
  constructor(
    public readonly reason: GithubIntegrationProviderErrorReason,
    message: string,
    public readonly retryAfterSeconds?: number | undefined,
  ) {
    super(message);
  }
}

export class GithubInstallStateError extends Error {}

export class GithubInstallationNotAuthorizedError extends Error {
  constructor(installationId: number) {
    super(`GitHub installation is not accessible to the installing user: ${installationId}`);
  }
}
