import {getHarness} from '#core/harness-policy.js';
import {toProviderCatalog, toProviderConfig} from '#hooks/api/model-provider-mapper.js';
import {
  customModelProviderConfig,
  managedModelProviderEntry,
  modelProviderCatalogResponse,
  modelProviderConfig,
} from '#test/fixtures/model-providers.js';
import {compatibleHarnessIds, isHarnessAvailable} from './harness-availability.js';

describe('harness availability', () => {
  test('marks pi available with any builtin provider config', () => {
    const result = isHarnessAvailable(getHarness('pi'), [
      toProviderConfig(modelProviderConfig({provider_id: 'openai'})),
    ]);

    expect(result).toBe(true);
  });

  test('marks pi available with only a custom provider config', () => {
    const result = isHarnessAvailable(getHarness('pi'), [
      toProviderConfig(customModelProviderConfig()),
    ]);

    expect(result).toBe(true);
  });

  test('marks claude available only when Anthropic is configured', () => {
    const openai = isHarnessAvailable(getHarness('claude'), [
      toProviderConfig(modelProviderConfig({provider_id: 'openai'})),
    ]);
    const anthropic = isHarnessAvailable(getHarness('claude'), [
      toProviderConfig(modelProviderConfig({provider_id: 'anthropic'})),
    ]);

    expect(openai).toBe(false);
    expect(anthropic).toBe(true);
  });

  test('marks both harnesses unavailable when no providers are configured', () => {
    expect(isHarnessAvailable(getHarness('pi'), [])).toBe(false);
    expect(isHarnessAvailable(getHarness('claude'), [])).toBe(false);
  });

  test('marks harnesses available from a managed-only catalog without workspace configs', () => {
    const catalog = toProviderCatalog(
      modelProviderCatalogResponse([managedModelProviderEntry()], 'disabled'),
    );

    expect(isHarnessAvailable(getHarness('pi'), [], catalog)).toBe(true);
    expect(isHarnessAvailable(getHarness('claude'), [], catalog)).toBe(true);
  });

  test('returns compatible harnesses for builtin and custom providers', () => {
    expect(compatibleHarnessIds({isCustom: false, providerId: 'anthropic'})).toEqual([
      'pi',
      'claude',
    ]);
    expect(compatibleHarnessIds({isCustom: false, providerId: 'openai'})).toEqual(['pi']);
    expect(compatibleHarnessIds({isCustom: true, providerId: 'custom-provider'})).toEqual(['pi']);
    expect(compatibleHarnessIds({isCustom: false, isManaged: true, providerId: 'shipfox'})).toEqual(
      ['pi', 'claude'],
    );
  });
});
