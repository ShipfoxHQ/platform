import {
  managedModelProviderEntry,
  modelProviderCatalogResponse,
  modelProviderConfigsResponse,
  modelProviderEntry,
} from '#test/fixtures/model-providers.js';
import {toProviderCatalog, toProviderConfiguration} from './model-provider-mapper.js';

test('maps provider catalog entries before they reach the client domain', () => {
  const catalog = toProviderCatalog(modelProviderCatalogResponse([modelProviderEntry()]));

  expect(catalog.providers).toEqual([
    expect.objectContaining({
      kind: 'supported',
      defaultModel: 'claude-opus-4-8',
      credentialFields: [{key: 'api_key', label: 'API key', secret: true}],
    }),
  ]);
});

test('maps the managed-only workspace policy and managed provider models', () => {
  const catalog = toProviderCatalog(
    modelProviderCatalogResponse([managedModelProviderEntry()], 'disabled', {
      managedProviderId: 'shipfox',
    }),
  );

  expect(catalog.workspaceProviders).toBe('disabled');
  expect(catalog.managedProviderId).toBe('shipfox');
  expect(catalog.instanceDefaultProviderId).toBeNull();
  expect(catalog.providers[0]).toEqual(
    expect.objectContaining({
      id: 'shipfox',
      models: [
        {id: 'claude-opus-4-8', label: 'Claude Opus 4.8', api: 'anthropic-messages'},
        {id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro', api: 'openai-responses'},
      ],
    }),
  );
});

test('maps the managed provider id and instance default provider id from a mixed catalog', () => {
  const catalog = toProviderCatalog(
    modelProviderCatalogResponse([modelProviderEntry(), managedModelProviderEntry()], 'enabled', {
      managedProviderId: 'shipfox',
      instanceDefaultProviderId: 'anthropic',
    }),
  );

  expect(catalog.workspaceProviders).toBe('enabled');
  expect(catalog.managedProviderId).toBe('shipfox');
  expect(catalog.instanceDefaultProviderId).toBe('anthropic');
  expect(catalog.providers).toHaveLength(2);
});

test('maps configuration response defaults and provider config fields', () => {
  const configuration = toProviderConfiguration(modelProviderConfigsResponse());

  expect(configuration.defaultProviderId).toBe('anthropic');
  expect(configuration.configs[0]).toEqual(
    expect.objectContaining({providerId: 'anthropic', defaultModel: null}),
  );
});
