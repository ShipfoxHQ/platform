import {compatibleHarnessIds, configSupportsHarness} from '#core/harness-policy.js';
import type {HarnessDescriptor, ProviderCatalog, ProviderConfig} from '#core/models.js';
import {isManagedOnlyCatalog, isSupportedProvider} from '#core/provider-policy.js';

export function isHarnessAvailable(
  descriptor: HarnessDescriptor,
  configs: readonly ProviderConfig[],
  catalog?: ProviderCatalog,
): boolean {
  return (
    configs.some((config) => configSupportsHarness(config, descriptor)) ||
    (isManagedOnlyCatalog(catalog) && (catalog?.providers.some(isSupportedProvider) ?? false))
  );
}

export {compatibleHarnessIds};
