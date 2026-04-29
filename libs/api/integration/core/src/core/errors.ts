import type {IntegrationCapability, IntegrationProviderKind} from '#core/entities/connection.js';

export class IntegrationConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`Integration connection not found: ${connectionId}`);
  }
}

export class IntegrationConnectionInactiveError extends Error {
  constructor(connectionId: string) {
    super(`Integration connection is not active: ${connectionId}`);
  }
}

export class IntegrationCapabilityUnavailableError extends Error {
  constructor(capability: IntegrationCapability, provider: IntegrationProviderKind) {
    super(`Integration provider ${provider} does not expose ${capability}`);
  }
}

export class IntegrationProviderUnavailableError extends Error {
  constructor(provider: IntegrationProviderKind) {
    super(`No integration provider registered for ${provider}`);
  }
}

export type IntegrationProviderErrorReason =
  | 'repository-not-found'
  | 'access-denied'
  | 'rate-limited'
  | 'timeout'
  | 'provider-unavailable'
  | 'malformed-provider-response';

export class IntegrationProviderError extends Error {
  constructor(
    public readonly reason: IntegrationProviderErrorReason,
    message: string,
    public readonly retryAfterSeconds?: number | undefined,
  ) {
    super(message);
  }
}
