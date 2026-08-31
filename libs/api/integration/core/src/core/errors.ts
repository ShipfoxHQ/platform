import {
  ConnectionSlugConflictError,
  IntegrationProviderError,
  type IntegrationProviderErrorReason,
} from '@shipfox/api-integration-spi';
import type {IntegrationCapability, IntegrationProviderKind} from '#core/entities/provider.js';

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

export class IntegrationConnectionWorkspaceMismatchError extends Error {
  constructor(connectionId: string) {
    super(`Integration connection does not belong to the requested workspace: ${connectionId}`);
  }
}

export class IntegrationConnectionProviderChangedError extends Error {
  constructor(connectionId: string) {
    super(`Integration connection provider changed: ${connectionId}`);
  }
}

export class IntegrationConnectionAlreadyExistsError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly provider: IntegrationProviderKind,
    public readonly externalAccountId: string,
  ) {
    super(`Integration connection already exists: ${workspaceId}/${provider}/${externalAccountId}`);
    this.name = 'IntegrationConnectionAlreadyExistsError';
  }
}

export class IntegrationCapabilityUnavailableError extends Error {
  constructor(
    public readonly capability: IntegrationCapability,
    public readonly provider: IntegrationProviderKind,
  ) {
    super(`Integration provider ${provider} does not expose ${capability}`);
  }
}

export class IntegrationCheckoutUnsupportedError extends Error {
  constructor(public readonly provider: IntegrationProviderKind) {
    super(`Integration provider ${provider} does not support checkout operations`);
  }
}

export class IntegrationProviderUnavailableError extends Error {
  constructor(public readonly provider: IntegrationProviderKind) {
    super(`No integration provider registered for ${provider}`);
  }
}

export class RepositoryAuthorizerConfigurationError extends Error {
  constructor() {
    super('Repository authorization is enabled but the Projects client is not configured');
    this.name = 'RepositoryAuthorizerConfigurationError';
  }
}

export class WebhookProcessorNotConfiguredError extends Error {
  constructor(public readonly routeId: string) {
    super(`No webhook processor is configured for ${routeId}`);
    this.name = 'WebhookProcessorNotConfiguredError';
  }
}

export {ConnectionSlugConflictError, IntegrationProviderError, type IntegrationProviderErrorReason};
