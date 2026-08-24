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

interface AgentToolCatalogMethod {
  readonly id: string;
  readonly description: string;
  readonly sensitivity: 'read' | 'write';
  readonly sensitive: boolean;
  readonly requiredScope: unknown;
}

interface AgentToolCatalogTool {
  readonly id: string;
  readonly description: string;
  readonly sensitivity: 'read' | 'write';
  readonly sensitive: boolean;
  readonly requiredScope: unknown;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly methods?: readonly AgentToolCatalogMethod[];
}

interface AgentToolCatalog {
  readonly tools: readonly AgentToolCatalogTool[];
}

export interface IntegrationValidationContext {
  readonly agentToolSelectionCatalogs: ReadonlyMap<
    IntegrationProviderKind,
    AgentToolSelectionCatalog
  >;
  /** Full tool catalogs, used to type tool-step inputs and outputs. */
  readonly agentToolCatalogs: ReadonlyMap<IntegrationProviderKind, AgentToolCatalog>;
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
