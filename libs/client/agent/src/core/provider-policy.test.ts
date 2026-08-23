import {toProviderCatalog} from '#hooks/api/model-provider-mapper.js';
import {
  managedModelProviderEntry,
  modelProviderCatalogResponse,
  modelProviderEntry,
} from '#test/fixtures/model-providers.js';
import {isManagedOnlyCatalog, managedProviderFromCatalog} from './provider-policy.js';

describe('managedProviderFromCatalog', () => {
  test('returns the managed entry from a managed-only catalog', () => {
    const catalog = toProviderCatalog(
      modelProviderCatalogResponse([managedModelProviderEntry()], 'disabled', {
        managedProviderId: 'shipfox',
      }),
    );

    expect(managedProviderFromCatalog(catalog)).toMatchObject({
      id: 'shipfox',
      kind: 'supported',
    });
    expect(isManagedOnlyCatalog(catalog)).toBe(true);
  });

  test('returns the managed entry from a mixed catalog under the enabled policy', () => {
    const catalog = toProviderCatalog(
      modelProviderCatalogResponse([modelProviderEntry(), managedModelProviderEntry()], 'enabled', {
        managedProviderId: 'shipfox',
      }),
    );

    expect(managedProviderFromCatalog(catalog)).toMatchObject({
      id: 'shipfox',
      kind: 'supported',
    });
    expect(isManagedOnlyCatalog(catalog)).toBe(false);
  });

  test('returns undefined without a managed provider id', () => {
    const catalog = toProviderCatalog(modelProviderCatalogResponse());

    expect(managedProviderFromCatalog(catalog)).toBeUndefined();
    expect(managedProviderFromCatalog(undefined)).toBeUndefined();
    expect(isManagedOnlyCatalog(catalog)).toBe(false);
  });
});
