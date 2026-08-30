import {
  ConnectionSlugConflictError,
  type IntegrationProviderErrorReason,
} from '@shipfox/api-integration-spi';
import {workspacesInterModuleContract} from '@shipfox/api-workspaces-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import {
  SlackAuthorizationScopeMismatchError,
  SlackConnectionAlreadyLinkedError,
  SlackEnterpriseInstallUnsupportedError,
  SlackInstallationAlreadyLinkedError,
  SlackInstallStateActorMismatchError,
  SlackInstallStateError,
  SlackIntegrationProviderError,
  SlackOAuthCallbackError,
  SlackTokenRotationUnsupportedError,
} from '#core/errors.js';

function providerStatus(reason: IntegrationProviderErrorReason): number {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}

export function slackRouteErrorHandler(error: unknown): never {
  if (
    isInterModuleKnownError(workspacesInterModuleContract.methods.requireActiveMembership, error)
  ) {
    throwSlackWorkspaceMembershipError(error);
  }
  if (error instanceof SlackInstallStateError) {
    throw new ClientError(error.message, 'invalid-slack-install-state', {status: 400});
  }
  if (error instanceof SlackInstallStateActorMismatchError) {
    throw new ClientError(error.message, 'slack-install-state-actor-mismatch', {status: 403});
  }
  if (error instanceof SlackInstallationAlreadyLinkedError) {
    throw new ClientError(error.message, 'slack-installation-already-linked', {status: 409});
  }
  if (error instanceof SlackConnectionAlreadyLinkedError) {
    throw new ClientError(error.message, 'slack-connection-already-linked', {status: 409});
  }
  if (error instanceof SlackAuthorizationScopeMismatchError) {
    throw new ClientError(error.message, 'slack-authorization-scope-mismatch', {
      status: 422,
      details: {missing_scopes: error.missingScopes},
    });
  }
  if (error instanceof SlackEnterpriseInstallUnsupportedError) {
    throw new ClientError(error.message, 'slack-enterprise-install-unsupported', {status: 422});
  }
  if (error instanceof SlackTokenRotationUnsupportedError) {
    throw new ClientError(error.message, 'slack-token-rotation-unsupported', {status: 422});
  }
  if (error instanceof SlackOAuthCallbackError) {
    throw new ClientError(error.message, 'slack-oauth-callback-error', {
      status: 422,
      details: {
        error: error.providerError,
        ...(error.providerDescription ? {error_description: error.providerDescription} : {}),
      },
    });
  }
  if (error instanceof ConnectionSlugConflictError) {
    throw new ClientError(error.message, 'slug-conflict', {status: 409});
  }
  if (error instanceof SlackIntegrationProviderError) {
    throw new ClientError(error.message, error.reason, {
      details: {retry_after_seconds: error.retryAfterSeconds},
      status: providerStatus(error.reason),
    });
  }
  throw error;
}

function throwSlackWorkspaceMembershipError(error: {
  code: 'workspace-not-found' | 'membership-required' | 'workspace-inactive';
  details: {workspaceId: string};
}): never {
  if (error.code === 'workspace-not-found') {
    throw new ClientError('Workspace not found', 'not-found', {
      status: 404,
      details: {workspace_id: error.details.workspaceId},
    });
  }
  if (error.code === 'membership-required') {
    throw new ClientError('Workspace membership required', 'forbidden', {
      status: 403,
      details: {workspace_id: error.details.workspaceId},
    });
  }
  throw new ClientError('Workspace is inactive', 'workspace-inactive', {
    status: 403,
    details: {workspace_id: error.details.workspaceId},
  });
}
