type IntegrationProviderKind = string;
type IntegrationCapability = 'source_control' | 'agent_tools';

export interface AgentToolSelectionCatalog {
  readonly selectors: readonly AgentToolSelector[];
}

export interface AgentToolSelector {
  readonly token: string;
  readonly kind: 'family' | 'family_wildcard' | 'method' | 'standalone';
  readonly sensitivity: 'read' | 'write';
  readonly sensitive: boolean;
}

export interface IntegrationWorkspaceConnection {
  readonly id: string;
  readonly provider: IntegrationProviderKind;
  readonly capabilities: readonly IntegrationCapability[];
}

export interface IntegrationValidationContext {
  readonly agentToolSelectionCatalogs: ReadonlyMap<
    IntegrationProviderKind,
    AgentToolSelectionCatalog
  >;
  readonly workspaceConnectionSnapshot: ReadonlyMap<string, IntegrationWorkspaceConnection>;
  /** Documented event names per provider; provider-minted names are never a closed set. */
  readonly eventCatalogs: ReadonlyMap<IntegrationProviderKind, ReadonlySet<string>>;
  /** Providers whose single event name is Shipfox-minted (`webhook` today). */
  readonly fixedEventProviders: ReadonlySet<IntegrationProviderKind>;
  readonly defaultConnectionSlug?: string | undefined;
}
