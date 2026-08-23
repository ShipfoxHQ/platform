type IntegrationProviderKind = string;
type IntegrationCapability = 'source_control' | 'agent_tools';

interface AgentToolSelectionCatalog {
  readonly selectors: readonly AgentToolSelector[];
}

interface AgentToolSelector {
  readonly token: string;
  readonly kind: 'family' | 'family_wildcard' | 'method' | 'standalone';
  readonly sensitivity: 'read' | 'write';
  readonly sensitive: boolean;
}

export interface IntegrationValidationContext {
  readonly agentToolSelectionCatalogs: ReadonlyMap<
    IntegrationProviderKind,
    AgentToolSelectionCatalog
  >;
  readonly workspaceConnectionSnapshot: ReadonlyMap<
    string,
    {
      readonly id: string;
      readonly provider: IntegrationProviderKind;
      readonly capabilities: readonly IntegrationCapability[];
    }
  >;
  /** Documented event names per provider; provider-minted names are never a closed set. */
  readonly eventCatalogs: ReadonlyMap<IntegrationProviderKind, ReadonlySet<string>>;
  /** Providers whose single event name is Shipfox-minted (`webhook` today). */
  readonly fixedEventProviders: ReadonlySet<IntegrationProviderKind>;
  readonly defaultConnectionSlug?: string | undefined;
}
