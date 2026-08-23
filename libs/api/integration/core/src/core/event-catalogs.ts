import type {IntegrationProviderRegistry} from '#core/providers/registry.js';

/**
 * Providers whose single event name is minted by Shipfox. An explicit event on
 * one of these providers is provably wrong unless it is that one name; every
 * other provider's event names are provider-minted and never treated as a
 * closed set. `manual` and `cron` are not providers: sync classifies them as
 * built-in sources by literal, before slug resolution.
 */
export const FIXED_EVENT_PROVIDERS = ['webhook'] as const;

export interface ProviderEventCatalog {
  provider: string;
  events: string[];
}

/** Collects the event names each registered provider documents. */
export function buildProviderEventCatalogs(
  registry: IntegrationProviderRegistry,
): ProviderEventCatalog[] {
  return registry.list().flatMap((provider) => {
    const catalog = provider.eventCatalog;
    if (catalog === undefined) return [];
    return [{provider: provider.provider, events: catalog.events.map((event) => event.name)}];
  });
}
