import {ClientError} from '@shipfox/node-fastify';
import {
  IntegrationCapabilityUnavailableError,
  IntegrationConnectionInactiveError,
  IntegrationConnectionNotFoundError,
  IntegrationConnectionWorkspaceMismatchError,
  IntegrationProviderError,
  type IntegrationProviderErrorReason,
  IntegrationProviderUnavailableError,
} from '#core/errors.js';

function providerStatus(reason: IntegrationProviderErrorReason): number {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}

function isProviderError(error: unknown): error is IntegrationProviderError {
  return (
    error instanceof IntegrationProviderError ||
    (error instanceof Error &&
      'reason' in error &&
      typeof error.reason === 'string' &&
      (error.reason === 'repository-not-found' ||
        error.reason === 'access-denied' ||
        error.reason === 'rate-limited' ||
        error.reason === 'timeout' ||
        error.reason === 'provider-unavailable' ||
        error.reason === 'malformed-provider-response'))
  );
}

export function integrationRouteErrorHandler(error: unknown): never {
  if (error instanceof IntegrationConnectionNotFoundError) {
    throw new ClientError(error.message, 'integration-connection-not-found', {status: 404});
  }
  if (error instanceof IntegrationConnectionInactiveError) {
    throw new ClientError(error.message, 'integration-connection-inactive', {status: 422});
  }
  if (error instanceof IntegrationConnectionWorkspaceMismatchError) {
    throw new ClientError(error.message, 'forbidden', {status: 403});
  }
  if (error instanceof IntegrationProviderUnavailableError) {
    throw new ClientError(error.message, 'integration-provider-unavailable', {status: 422});
  }
  if (error instanceof IntegrationCapabilityUnavailableError) {
    throw new ClientError(error.message, 'integration-capability-unavailable', {status: 422});
  }
  if (isProviderError(error)) {
    throw new ClientError(error.message, error.reason, {
      details: {retry_after_seconds: error.retryAfterSeconds},
      status: providerStatus(error.reason),
    });
  }
  throw error;
}
