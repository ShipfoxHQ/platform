import type {
  HarnessDescriptor,
  ProviderCatalog,
  ProviderCatalogEntry,
  ProviderConfig,
  SupportedProvider,
} from './models.js';

export function isSupportedProvider(entry: ProviderCatalogEntry): entry is SupportedProvider {
  return entry.kind === 'supported';
}

export function supportsProvider(harness: HarnessDescriptor, providerId: string): boolean {
  return harness.supportedProviderIds.includes(providerId);
}

export function isManagedOnlyCatalog(catalog: ProviderCatalog | undefined): boolean {
  return catalog?.workspaceProviders === 'disabled';
}

export function managedProviderFromCatalog(
  catalog: ProviderCatalog | undefined,
): SupportedProvider | undefined {
  const providers = catalog?.providers;
  const managedProviderId = catalog?.managedProviderId;
  if (providers === undefined) return undefined;
  if (managedProviderId === null || managedProviderId === undefined) {
    return isManagedOnlyCatalog(catalog) ? providers.find(isSupportedProvider) : undefined;
  }
  const managedEntry = providers.find((provider) => provider.id === managedProviderId);
  return managedEntry !== undefined && isSupportedProvider(managedEntry) ? managedEntry : undefined;
}

export function availableProviders(
  catalog: readonly ProviderCatalogEntry[],
  configs: readonly ProviderConfig[],
): SupportedProvider[] {
  const configuredIds = new Set(configs.map((config) => config.providerId));
  return catalog.filter(isSupportedProvider).filter((provider) => !configuredIds.has(provider.id));
}

export function providerMatchesSearch(entry: SupportedProvider, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const terms = [
    entry.id,
    entry.label,
    ...entry.models.flatMap((model) => [model.id, model.label]),
  ];
  return terms.some((term) => term.toLocaleLowerCase().includes(needle));
}

export function customProviderCardMatchesSearch(query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return 'custom provider openai anthropic google endpoint https public'.includes(needle);
}

export function deriveProviderSlug(displayName: string): string {
  return displayName
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const PROVIDER_SLUG_RE = /^[a-z][a-z0-9-]{1,62}$/;

export function isProviderSlugValid(slug: string): boolean {
  return PROVIDER_SLUG_RE.test(slug);
}
