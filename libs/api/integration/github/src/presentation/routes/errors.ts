import {ClientError} from '@shipfox/node-fastify';
import {
  GithubInstallationNotAuthorizedError,
  GithubInstallStateError,
  GithubIntegrationProviderError,
  type GithubIntegrationProviderErrorReason,
} from '#core/errors.js';

function providerStatus(reason: GithubIntegrationProviderErrorReason): number {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}

export function githubRouteErrorHandler(error: unknown): never {
  if (error instanceof GithubInstallStateError) {
    throw new ClientError(error.message, 'invalid-github-install-state', {status: 400});
  }
  if (error instanceof GithubInstallationNotAuthorizedError) {
    throw new ClientError(error.message, 'github-installation-not-authorized', {status: 403});
  }
  if (error instanceof GithubIntegrationProviderError) {
    throw new ClientError(error.message, error.reason, {
      details: {retry_after_seconds: error.retryAfterSeconds},
      status: providerStatus(error.reason),
    });
  }
  throw error;
}
