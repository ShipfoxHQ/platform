import type {CatalogCapability, CatalogProvider} from '@/lib/integration-catalog';

export function validateIntegrationCatalog(
  providers: readonly CatalogProvider[],
  expectedCapabilitiesBySlug: Record<string, readonly CatalogCapability[]> = {},
): void {
  const providerSlugs = new Set(providers.map((provider) => provider.slug));
  for (const slug of Object.keys(expectedCapabilitiesBySlug)) {
    if (!providerSlugs.has(slug))
      throw new Error(`Generated DTO catalog for "${slug}" has no matching provider page.`);
  }

  for (const provider of providers) {
    const prefix = `Integration catalog provider "${provider.slug}"`;
    const expectedCapabilities = expectedCapabilitiesBySlug[provider.slug] ?? [];

    for (const capability of expectedCapabilities) {
      if (!provider.capabilities.includes(capability))
        throw new Error(`${prefix} has a ${capability} DTO catalog but omits that capability.`);
    }

    if (provider.capabilities.includes('events') && provider.eventCount === 0)
      throw new Error(`${prefix} declares events but its event count is 0.`);
    if (provider.capabilities.includes('agent_tools') && provider.toolCount === 0)
      throw new Error(`${prefix} declares agent tools but its tool count is 0.`);
    if (provider.availability === 'coming-soon' && provider.capabilities.length > 0)
      throw new Error(`${prefix} is coming soon but declares capabilities.`);
    if (provider.availability === 'available' && !provider.setupHref)
      throw new Error(`${prefix} is available but has no setup page.`);
  }
}
