import {
  type AgentToolCatalogEntry,
  type AgentToolSelectionCatalog,
  assertAgentToolCatalogRepositoryScopes,
  type IntegrationCapability,
  type IntegrationProviderKind,
} from '@shipfox/api-integration-spi';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import {listIntegrationConnections} from '#db/connections.js';

export type AgentToolSelectionCatalogs = ReadonlyMap<
  IntegrationProviderKind,
  AgentToolSelectionCatalog
>;
export type AgentToolCatalogs = ReadonlyMap<
  IntegrationProviderKind,
  readonly AgentToolCatalogEntry[]
>;

export interface WorkspaceConnectionSnapshotEntry {
  readonly id: string;
  readonly provider: IntegrationProviderKind;
  readonly capabilities: readonly IntegrationCapability[];
}

export type WorkspaceConnectionSnapshot = ReadonlyMap<string, WorkspaceConnectionSnapshotEntry>;
export type LoadWorkspaceConnectionSnapshot = (
  workspaceId: string,
) => Promise<WorkspaceConnectionSnapshot>;

export async function buildAgentToolSelectionCatalogs(
  registry: IntegrationProviderRegistry,
): Promise<AgentToolSelectionCatalogs> {
  const entries = await Promise.all(
    registry.list('agent_tools').map(async (provider) => {
      const adapter = provider.adapters.agent_tools;
      if (adapter === undefined) {
        throw new Error(`Integration provider "${provider.provider}" has no agent tools adapter`);
      }
      return [provider.provider, await adapter.selectionCatalog()] as const;
    }),
  );
  return new Map(entries);
}

export async function buildAgentToolCatalogs(
  registry: IntegrationProviderRegistry,
): Promise<AgentToolCatalogs> {
  const entries = await Promise.all(
    registry.list('agent_tools').map(async (provider) => {
      const adapter = provider.adapters.agent_tools;
      if (adapter === undefined) {
        throw new Error(`Integration provider "${provider.provider}" has no agent tools adapter`);
      }
      const catalog = await adapter.catalog();
      if (provider.repositoryAuthorization === 'enforced') {
        assertAgentToolCatalogRepositoryScopes(catalog);
      }
      return [provider.provider, catalog] as const;
    }),
  );
  return new Map(entries);
}

export function createWorkspaceConnectionSnapshotLoader(
  registry: IntegrationProviderRegistry,
): LoadWorkspaceConnectionSnapshot {
  const capabilitiesByProvider = new Map(
    registry.list().map((provider) => [provider.provider, provider.capabilities]),
  );

  return async (workspaceId) => {
    const connections = await listIntegrationConnections({workspaceId});
    return new Map(
      connections.map((connection) => [
        connection.slug,
        {
          id: connection.id,
          provider: connection.provider,
          capabilities: capabilitiesByProvider.get(connection.provider) ?? [],
        },
      ]),
    );
  };
}
