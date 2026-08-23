import {createIntegrationProviderRegistry} from '#core/providers/registry.js';
import {buildFixedEventProviders} from './event-catalogs.js';

describe('buildFixedEventProviders', () => {
  it('omits fixed providers that are not registered', () => {
    expect(buildFixedEventProviders(createIntegrationProviderRegistry([]))).toEqual([]);
  });

  it('keeps a registered fixed provider in the context metadata', () => {
    expect(
      buildFixedEventProviders(
        createIntegrationProviderRegistry([{provider: 'webhook', displayName: 'Webhook'}]),
      ),
    ).toEqual(['webhook']);
  });
});
