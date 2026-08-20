import type {ManagedModelProvider} from '@shipfox/api-agent-dto';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {secretsInterModuleContract} from '@shipfox/api-secrets-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
  isInterModuleKnownError,
} from '@shipfox/inter-module';
import {
  InvalidAgentModelError,
  ModelProviderConfigNotFoundError,
  UnsupportedHarnessProviderError,
  UnsupportedHarnessThinkingError,
  UnsupportedModelProviderError,
} from '#core/errors.js';
import {resolveAgentConfig} from '#core/resolve-agent-config.js';
import {resolveRuntimeCredentials} from '#core/resolve-runtime-credentials.js';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import {getAgentValidationCatalog} from '#core/validation-catalog.js';
import {createWorkspaceAgentDefaultsResolver} from '#core/workspace-agent-defaults-resolver.js';

export function createAgentInterModulePresentation(params: {
  secrets: AgentSecretsClient;
  managedProvider?: ManagedModelProvider | undefined;
}): InterModulePresentation<typeof agentInterModuleContract> {
  return defineInterModulePresentation(agentInterModuleContract, {
    getValidationCatalog: () => getAgentValidationCatalog(params.managedProvider),
    resolveAgentConfig: async ({workspaceId, config}) => {
      try {
        const resolve =
          workspaceId === null
            ? (step: Parameters<typeof resolveAgentConfig>[0]) =>
                resolveAgentConfig(step, {managedProvider: params.managedProvider})
            : await createWorkspaceAgentDefaultsResolver(workspaceId, params.managedProvider);
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
        });
      } catch (error) {
        throw toResolveRuntimeCredentialsKnownError(error);
      }
    },
  });
}

function toResolveAgentConfigKnownError(error: unknown): unknown {
  if (
    error instanceof InvalidAgentModelError ||
    error instanceof UnsupportedHarnessProviderError ||
    error instanceof UnsupportedHarnessThinkingError ||
    error instanceof UnsupportedModelProviderError
  ) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.resolveAgentConfig,
      'agent-config-invalid',
      {},
    );
  }
  return error;
}

function toResolveRuntimeCredentialsKnownError(error: unknown): unknown {
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
