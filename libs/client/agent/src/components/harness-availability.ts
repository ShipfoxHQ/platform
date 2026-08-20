import {
  compatibleHarnessIds,
  configSupportsHarness,
  managedModelSupportsHarness,
} from '#core/harness-policy.js';
import type {HarnessDescriptor, ProviderCatalog, ProviderConfig} from '#core/models.js';
import {isManagedOnlyCatalog, isSupportedProvider} from '#core/provider-policy.js';

export function isHarnessAvailable(
  descriptor: HarnessDescriptor,
  configs: readonly ProviderConfig[],
  catalog?: ProviderCatalog,
): boolean {
  return (
    configs.some((config) => configSupportsHarness(config, descriptor)) ||
    (isManagedOnlyCatalog(catalog) &&
      (catalog?.providers.some(
        (provider) =>
          isSupportedProvider(provider) &&
          provider.models.some((model) => managedModelSupportsHarness(descriptor.id, model)),
      ) ??
        false))
  );
}

export {compatibleHarnessIds};
