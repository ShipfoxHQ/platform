import type {ManagedModelProvider, WorkspaceProvidersPolicy} from '@shipfox/api-agent-dto';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {secretsInterModuleContract} from '@shipfox/api-secrets-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
  isInterModuleKnownError,
} from '@shipfox/inter-module';
import {claimStepSession} from '#core/claim-step-session.js';
import {
  AgentSessionCarryOverConflictError,
  AgentSessionHarnessMismatchError,
  AgentSessionHeldError,
  AgentSessionKeyInvalidError,
  AgentSessionLockUnavailableError,
  InvalidAgentModelError,
  ModelProviderConfigNotFoundError,
  UnsupportedHarnessProviderError,
  UnsupportedHarnessThinkingError,
  UnsupportedModelProviderError,
  WorkspaceProvidersDisabledError,
} from '#core/errors.js';
import {resolveAgentConfig} from '#core/resolve-agent-config.js';
import {resolveRuntimeCredentials} from '#core/resolve-runtime-credentials.js';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import {getAgentValidationCatalog} from '#core/validation-catalog.js';
import {createWorkspaceAgentDefaultsResolver} from '#core/workspace-agent-defaults-resolver.js';
import {carryOverSessions} from '#db/index.js';

export function createAgentInterModulePresentation(params: {
  secrets: AgentSecretsClient;
  managedProvider?: ManagedModelProvider | undefined;
  workspaceProviders?: WorkspaceProvidersPolicy | undefined;
}): InterModulePresentation<typeof agentInterModuleContract> {
  return defineInterModulePresentation(agentInterModuleContract, {
    getValidationCatalog: () =>
      getAgentValidationCatalog(params.managedProvider, params.workspaceProviders),
    resolveAgentConfig: async ({workspaceId, config}) => {
      try {
        const resolve =
          workspaceId === null
            ? (step: Parameters<typeof resolveAgentConfig>[0]) =>
                resolveAgentConfig(step, {
                  managedProvider: params.managedProvider,
                  workspaceProviders: params.workspaceProviders,
                })
            : await createWorkspaceAgentDefaultsResolver(
                workspaceId,
                params.managedProvider,
                params.workspaceProviders,
              );
        return await resolve(config);
      } catch (error) {
        throw toResolveAgentConfigKnownError(error);
      }
    },
    resolveRuntimeCredentials: async (input) => {
      try {
        return await resolveRuntimeCredentials(input, {
          managedProvider: params.managedProvider,
          secrets: params.secrets,
          workspaceProviders: params.workspaceProviders,
        });
      } catch (error) {
        throw toResolveRuntimeCredentialsKnownError(error);
      }
    },
    claimSession: async (input) => {
      try {
        return await claimStepSession(input);
      } catch (error) {
        throw toClaimSessionKnownError(error);
      }
    },
    carryOverSessions: async (input) => {
      try {
        const carried = await carryOverSessions(input);
        return {
          sessions: carried.map((session) => ({
            id: session.id,
            key: session.key,
            segment: session.headSegment,
          })),
        };
      } catch (error) {
        throw toCarryOverSessionsKnownError(error);
      }
    },
  });
}

function toResolveAgentConfigKnownError(error: unknown): unknown {
  if (
    error instanceof InvalidAgentModelError ||
    error instanceof UnsupportedHarnessProviderError ||
    error instanceof UnsupportedHarnessThinkingError ||
    error instanceof UnsupportedModelProviderError ||
    error instanceof WorkspaceProvidersDisabledError
  ) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.resolveAgentConfig,
      'agent-config-invalid',
      {
        ...(error instanceof WorkspaceProvidersDisabledError
          ? {message: error.message, managed_provider_id: error.managedProviderId}
          : {}),
      },
    );
  }
  return error;
}

function toResolveRuntimeCredentialsKnownError(error: unknown): unknown {
  if (error instanceof WorkspaceProvidersDisabledError) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.resolveRuntimeCredentials,
      'workspace-providers-disabled',
      {
        message: error.message,
        managed_provider_id: error.managedProviderId,
      },
    );
  }
  if (error instanceof ModelProviderConfigNotFoundError) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.resolveRuntimeCredentials,
      'model-provider-not-configured',
      {},
    );
  }
  if (isInterModuleKnownError(secretsInterModuleContract.methods.getSecretsByNamespace, error)) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.resolveRuntimeCredentials,
      'model-provider-credentials-invalid',
      {},
    );
  }
  return error;
}

function toClaimSessionKnownError(error: unknown): unknown {
  const method = agentInterModuleContract.methods.claimSession;
  if (error instanceof AgentSessionKeyInvalidError) {
    return createInterModuleKnownError(method, 'session-key-invalid', {});
  }
  if (error instanceof AgentSessionHeldError) {
    return createInterModuleKnownError(method, 'session-held', {});
  }
  if (error instanceof AgentSessionHarnessMismatchError) {
    return createInterModuleKnownError(method, 'session-harness-mismatch', {});
  }
  if (error instanceof AgentSessionLockUnavailableError) {
    return createInterModuleKnownError(method, 'session-lock-unavailable', {});
  }
  return error;
}

function toCarryOverSessionsKnownError(error: unknown): unknown {
  if (error instanceof AgentSessionCarryOverConflictError) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.carryOverSessions,
      'carry-over-conflict',
      {},
    );
  }
  return error;
}
