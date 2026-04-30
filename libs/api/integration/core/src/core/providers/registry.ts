import type {
  IntegrationCapability,
  IntegrationProvider,
  IntegrationProviderKind,
} from '#core/entities/provider.js';
import {
  IntegrationCapabilityUnavailableError,
  IntegrationProviderUnavailableError,
} from '#core/errors.js';

export interface IntegrationProviderRegistry {
  list(capability?: IntegrationCapability | undefined): IntegrationProvider[];
  get(provider: IntegrationProviderKind): IntegrationProvider;
  getSourceControl(
    provider: IntegrationProviderKind,
  ): NonNullable<IntegrationProvider['sourceControl']>;
}

export function createIntegrationProviderRegistry(
  providers: IntegrationProvider[],
): IntegrationProviderRegistry {
  return new MapIntegrationProviderRegistry(providers);
}

class MapIntegrationProviderRegistry implements IntegrationProviderRegistry {
  private readonly providers: Map<IntegrationProviderKind, IntegrationProvider>;

  constructor(providers: IntegrationProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.provider, provider]));
  }

  list(capability?: IntegrationCapability | undefined): IntegrationProvider[] {
    const providers = [...this.providers.values()];
    if (!capability) return providers;
    return providers.filter((provider) => provider.capabilities.includes(capability));
  }

  get(provider: IntegrationProviderKind): IntegrationProvider {
    const resolved = this.providers.get(provider);
    if (!resolved) throw new IntegrationProviderUnavailableError(provider);
    return resolved;
  }

  getSourceControl(
    provider: IntegrationProviderKind,
  ): NonNullable<IntegrationProvider['sourceControl']> {
    const resolved = this.get(provider);
    if (!resolved.sourceControl) {
      throw new IntegrationCapabilityUnavailableError('source_control', provider);
    }
    return resolved.sourceControl;
  }
}
