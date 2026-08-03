export const INTEGRATION_CATALOG_AVAILABILITIES = ['available', 'preview', 'coming-soon'] as const;
export const INTEGRATION_CATALOG_CAPABILITIES = [
  'source_control',
  'events',
  'agent_tools',
] as const;
export const INTEGRATION_CATALOG_CATEGORIES = [
  'source-control',
  'observability',
  'custom',
  'issue-tracking',
  'messaging',
] as const;
export const INTEGRATION_CATALOG_ICONS = [
  'github',
  'sentry',
  'webhooks',
  'linear',
  'slack',
] as const;

export type CatalogAvailability = (typeof INTEGRATION_CATALOG_AVAILABILITIES)[number];
export type CatalogCapability = (typeof INTEGRATION_CATALOG_CAPABILITIES)[number];
export type CatalogCategory = (typeof INTEGRATION_CATALOG_CATEGORIES)[number];
export type CatalogIcon = (typeof INTEGRATION_CATALOG_ICONS)[number];

export const catalogAvailabilityLabels: Record<CatalogAvailability, string> = {
  available: 'Available',
  preview: 'Preview',
  'coming-soon': 'Coming soon',
};

export const catalogCapabilityLabels: Record<CatalogCapability, string> = {
  source_control: 'Code checkout',
  events: 'Events',
  agent_tools: 'Agent tools',
};

export const catalogCategoryLabels: Record<CatalogCategory, string> = {
  'source-control': 'Source control',
  observability: 'Observability',
  custom: 'Webhook',
  'issue-tracking': 'Issue tracking',
  messaging: 'Messaging',
};

export interface CatalogProvider {
  slug: string;
  name: string;
  summary: string;
  availability: CatalogAvailability;
  capabilities: CatalogCapability[];
  categories: CatalogCategory[];
  aliases: string[];
  icon: CatalogIcon;
  overviewHref: string;
  setupHref?: string;
  eventCount: number;
  toolCount: number;
}

export interface CatalogFilters {
  query: string;
  capability: readonly CatalogCapability[];
  category: readonly CatalogCategory[];
}

export const emptyCatalogFilters: CatalogFilters = {
  query: '',
  capability: [],
  category: [],
};

export function filterProviders(
  providers: readonly CatalogProvider[],
  filters: CatalogFilters,
): CatalogProvider[] {
  const query = filters.query.trim().toLocaleLowerCase();

  return providers.filter((provider) => {
    return (
      matchesQuery(provider, query) &&
      matchesCapabilities(provider, filters.capability) &&
      matchesCategories(provider, filters.category)
    );
  });
}

export function countFacetValues(
  providers: readonly CatalogProvider[],
  filters: CatalogFilters,
): {
  capability: Record<CatalogCapability, number>;
  category: Record<CatalogCategory, number>;
} {
  const query = filters.query.trim().toLocaleLowerCase();

  return {
    capability: countValues(INTEGRATION_CATALOG_CAPABILITIES, (capability) =>
      providers.filter(
        (provider) =>
          matchesQuery(provider, query) &&
          matchesCategories(provider, filters.category) &&
          provider.capabilities.includes(capability),
      ),
    ),
    category: countValues(INTEGRATION_CATALOG_CATEGORIES, (category) =>
      providers.filter(
        (provider) =>
          matchesQuery(provider, query) &&
          matchesCapabilities(provider, filters.capability) &&
          provider.categories.includes(category),
      ),
    ),
  };
}

function countValues<Value extends string>(
  values: readonly Value[],
  matches: (value: Value) => readonly CatalogProvider[],
): Record<Value, number> {
  const counts = {} as Record<Value, number>;

  for (const value of values) {
    counts[value] = matches(value).length;
  }

  return counts;
}

function matchesQuery(provider: CatalogProvider, query: string): boolean {
  if (query.length === 0) return true;

  const searchableText = [
    provider.name,
    provider.summary,
    ...provider.categories.map((category) => catalogCategoryLabels[category]),
    ...provider.aliases,
  ]
    .join(' ')
    .toLocaleLowerCase();

  return searchableText.includes(query);
}

function matchesCapabilities(
  provider: CatalogProvider,
  capabilities: readonly CatalogCapability[],
): boolean {
  return (
    capabilities.length === 0 ||
    capabilities.some((capability) => provider.capabilities.includes(capability))
  );
}

function matchesCategories(
  provider: CatalogProvider,
  categories: readonly CatalogCategory[],
): boolean {
  return (
    categories.length === 0 || categories.some((category) => provider.categories.includes(category))
  );
}
