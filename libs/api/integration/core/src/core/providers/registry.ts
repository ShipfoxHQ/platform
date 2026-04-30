import type {
  IntegrationCapability,
  IntegrationProvider,
  IntegrationProviderAdapters,
  IntegrationProviderKind,
  RegisteredIntegrationProvider,
} from '#core/entities/provider.js';
import {
  IntegrationCapabilityUnavailableError,
  IntegrationProviderUnavailableError,
} from '#core/errors.js';

const providerIdPattern = /^[a-z][a-z0-9_-]*$/;

export interface IntegrationProviderRegistry {
  list(capability?: IntegrationCapability | undefined): RegisteredIntegrationProvider[];
  get(provider: IntegrationProviderKind): RegisteredIntegrationProvider;
  getAdapter<Capability extends IntegrationCapability>(
    provider: IntegrationProviderKind,
    capability: Capability,
  ): NonNullable<IntegrationProviderAdapters[Capability]>;
  getSourceControl(
    provider: IntegrationProviderKind,
  ): NonNullable<IntegrationProviderAdapters['source_control']>;
}

export function createIntegrationProviderRegistry(
  providers: IntegrationProvider[],
): IntegrationProviderRegistry {
  return new MapIntegrationProviderRegistry(providers);
}

class MapIntegrationProviderRegistry implements IntegrationProviderRegistry {
  private readonly providers: Map<IntegrationProviderKind, RegisteredIntegrationProvider>;

  constructor(providers: IntegrationProvider[]) {
    this.providers = new Map();

    for (const provider of providers) {
      if (!providerIdPattern.test(provider.provider)) {
        throw new Error(`Invalid integration provider id: ${provider.provider}`);
      }
      if (this.providers.has(provider.provider)) {
        throw new Error(`Duplicate integration provider registered: ${provider.provider}`);
      }

      this.providers.set(provider.provider, normalizeProvider(provider));
    }
  }

  list(capability?: IntegrationCapability | undefined): RegisteredIntegrationProvider[] {
    const providers = [...this.providers.values()];
    if (!capability) return providers;
    return providers.filter((provider) => provider.capabilities.includes(capability));
  }

  get(provider: IntegrationProviderKind): RegisteredIntegrationProvider {
    const resolved = this.providers.get(provider);
    if (!resolved) throw new IntegrationProviderUnavailableError(provider);
    return resolved;
  }

  getAdapter<Capability extends IntegrationCapability>(
    provider: IntegrationProviderKind,
    capability: Capability,
  ): NonNullable<IntegrationProviderAdapters[Capability]> {
    const resolved = this.get(provider);
    const adapter = resolved.adapters[capability];
    if (!adapter) {
      throw new IntegrationCapabilityUnavailableError(capability, provider);
    }
    return adapter as NonNullable<IntegrationProviderAdapters[Capability]>;
  }

  getSourceControl(
    provider: IntegrationProviderKind,
  ): NonNullable<IntegrationProviderAdapters['source_control']> {
    return this.getAdapter(provider, 'source_control');
  }
}

function normalizeProvider(provider: IntegrationProvider): RegisteredIntegrationProvider {
  const adapters = provider.adapters ?? {};
  return {
    ...provider,
    adapters,
    capabilities: Object.entries(adapters)
      .filter(([, adapter]) => Boolean(adapter))
      .map(([capability]) => capability as IntegrationCapability),
  };
}
