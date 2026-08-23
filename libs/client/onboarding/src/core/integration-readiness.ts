import {
  type IntegrationCapability,
  type IntegrationConnection,
  type IntegrationProvider,
  isUsableConnection,
} from '@shipfox/client-integrations';

/**
 * Per-provider connection state for the workspace setup readiness model.
 * `connected` and `attention` are mutually exclusive: a provider with at
 * least one active connection is connected, a provider whose connections
 * exist but are all inactive needs attention, and a provider without
 * connections is neither.
 */
export interface IntegrationProviderReadiness {
  provider: string;
  displayName: string;
  capabilities: ReadonlyArray<IntegrationCapability>;
  connected: boolean;
  attention: boolean;
}

export interface WorkspaceIntegrationReadiness {
  providers: ReadonlyArray<IntegrationProviderReadiness>;
  /** Providers in attention, most recently updated connection first. */
  attentionProviders: readonly string[];
  /** At least one active connection to a source-control provider. */
  hasSourceControl: boolean;
  /** At least one active connection to a provider without `source_control`. */
  hasToolIntegration: boolean;
}

export interface IntegrationReadinessInput {
  providers: readonly IntegrationProvider[];
  connections: readonly IntegrationConnection[];
}

/**
 * Derives the workspace integration readiness from the provider catalog and
 * the workspace's connections. The result is the shared input for the setup
 * checklist and for the first-workflow spec's contextual "Connect X" prompt.
 */
export function deriveIntegrationReadiness({
  providers,
  connections,
}: IntegrationReadinessInput): WorkspaceIntegrationReadiness {
  const readiness = providers.map((provider) => {
    const providerConnections = connections.filter(
      (connection) => connection.provider === provider.provider,
    );
    const connected = providerConnections.some(isUsableConnection);
    return {
      provider: provider.provider,
      displayName: provider.displayName,
      capabilities: provider.capabilities,
      connected,
      attention: providerConnections.length > 0 && !connected,
    };
  });

  const latestConnectionUpdate = latestConnectionUpdateByProvider(connections);

  const attentionProviders = readiness
    .filter((provider) => provider.attention)
    .sort((a, b) => {
      const aUpdate = latestConnectionUpdate.get(a.provider) ?? 0;
      const bUpdate = latestConnectionUpdate.get(b.provider) ?? 0;
      return bUpdate - aUpdate;
    })
    .map((provider) => provider.provider);

  const hasSourceControl = readiness.some(
    (provider) => provider.connected && provider.capabilities.includes('source_control'),
  );
  const hasToolIntegration = readiness.some(
    (provider) => provider.connected && !provider.capabilities.includes('source_control'),
  );

  return {providers: readiness, attentionProviders, hasSourceControl, hasToolIntegration};
}

function latestConnectionUpdateByProvider(
  connections: readonly IntegrationConnection[],
): Map<string, number> {
  const updates = new Map<string, number>();
  for (const connection of connections) {
    const timestamp = Date.parse(connection.updatedAt);
    if (Number.isNaN(timestamp)) continue;
    const current = updates.get(connection.provider) ?? 0;
    if (timestamp > current) updates.set(connection.provider, timestamp);
  }
  return updates;
}
