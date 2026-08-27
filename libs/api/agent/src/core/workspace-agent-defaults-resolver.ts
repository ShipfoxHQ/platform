import {
  type AgentThinking,
  DEFAULT_HARNESS,
  type ManagedModelProvider,
  type ModelProviderRef,
  type WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
import type {AgentValidationCatalog} from '@shipfox/api-agent-dto/inter-module';
import {config} from '#config.js';
import {getAgentWorkspaceDefaultsSnapshot} from '#db/index.js';
import type {AgentConfigResolutionContext, AgentDefaultsResolver} from './resolve-agent-config.js';
import {resolveAgentConfig} from './resolve-agent-config.js';
import {getAgentValidationCatalog} from './validation-catalog.js';

export async function getWorkspaceAgentValidationCatalog(
  workspaceId: string,
  managedProvider?: ManagedModelProvider | undefined,
  workspaceProviders?: WorkspaceProvidersPolicy | undefined,
): Promise<AgentValidationCatalog> {
  const snapshot = await getAgentWorkspaceDefaultsSnapshot(workspaceId);
  return getAgentValidationCatalog(
    managedProvider,
    workspaceProviders,
    snapshot.defaultHarnessId ?? DEFAULT_HARNESS,
  );
}

export async function createWorkspaceAgentDefaultsResolver(
  workspaceId: string,
  managedProvider?: ManagedModelProvider | undefined,
  workspaceProviders?: WorkspaceProvidersPolicy | undefined,
): Promise<AgentDefaultsResolver> {
  const snapshot = await getAgentWorkspaceDefaultsSnapshot(workspaceId);
  const workspaceProviderConfigs = new Map<
    ModelProviderRef,
    {
      kind: 'builtin' | 'custom';
      defaultModel: string | null;
      defaultThinking: AgentThinking;
      models: (typeof snapshot.providerConfigs)[number]['models'];
    }
  >();
  for (const providerConfig of snapshot.providerConfigs) {
    workspaceProviderConfigs.set(providerConfig.providerId, {
      kind: providerConfig.kind,
      defaultModel: providerConfig.defaultModel,
      defaultThinking: providerConfig.defaultThinking,
      models: providerConfig.models,
    });
  }
  const ctx: AgentConfigResolutionContext = {
    workspaceDefaultHarnessId: snapshot.defaultHarnessId ?? null,
    workspaceDefaultProviderId: snapshot.defaultProviderId ?? null,
    workspaceProviderConfigs,
    instanceDefaultProvider: config.AGENT_DEFAULT_PROVIDER,
    instanceDefaultModel: config.AGENT_DEFAULT_PROVIDER_MODEL,
    instanceDefaultThinking: config.AGENT_DEFAULT_PROVIDER_THINKING as AgentThinking | undefined,
    managedProvider,
    workspaceProviders,
  };

  return (step) => resolveAgentConfig(step, ctx);
}
