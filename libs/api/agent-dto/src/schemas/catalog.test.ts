import {
  agentThinkingSchema,
  DEFAULT_AGENT_THINKING,
  getModelProviderEntry,
  listSupportedModelProviders,
  MODEL_PROVIDER_CATALOG_SEED,
  modelProviderCatalogEntrySchema,
  modelProviderCatalogResponseSchema,
  modelProviderCatalogSeedSchema,
} from './catalog.js';
import {
  MODEL_PROVIDER_IDS,
  SUPPORTED_MODEL_PROVIDER_IDS,
  UNSUPPORTED_MODEL_PROVIDER_IDS,
} from './model-provider-id.js';

const managedProviderCatalogEntry = {
  id: 'shipfox-managed',
  label: 'Shipfox Managed',
  support_status: 'supported',
  default_model: 'managed-claude',
  credential_fields: [],
  unsupported_reason: null,
  models: [{id: 'managed-claude', label: 'Managed Claude'}],
};

describe('model provider catalog', () => {
  it('parses the catalog seed', () => {
    const parsed = modelProviderCatalogSeedSchema.array().parse(MODEL_PROVIDER_CATALOG_SEED);

    expect(parsed).toHaveLength(37);
  });

  it('rejects a supported provider without a default model', () => {
    const parse = () =>
      modelProviderCatalogSeedSchema.parse({
        id: 'openai',
        label: 'OpenAI',
        support_status: 'supported',
        default_model: null,
        credential_fields: [{key: 'api_key', label: 'API key', secret: true}],
        unsupported_reason: null,
      });

    expect(parse).toThrow();
  });

  it('rejects a supported provider without credential fields', () => {
    const parse = () =>
      modelProviderCatalogSeedSchema.parse({
        id: 'openai',
        label: 'OpenAI',
        support_status: 'supported',
        default_model: 'gpt-5.5-pro',
        credential_fields: [],
        unsupported_reason: null,
      });

    expect(parse).toThrow();
  });

  it('rejects an unsupported provider with a default model', () => {
    const parse = () =>
      modelProviderCatalogSeedSchema.parse({
        id: 'github-copilot',
        label: 'GitHub Copilot',
        support_status: 'unsupported',
        default_model: 'gpt-5.5-pro',
        credential_fields: [],
        unsupported_reason: 'OAuth is not supported.',
      });

    expect(parse).toThrow();
  });

  it('rejects an unsupported provider with credential fields', () => {
    const parse = () =>
      modelProviderCatalogSeedSchema.parse({
        id: 'github-copilot',
        label: 'GitHub Copilot',
        support_status: 'unsupported',
        default_model: null,
        credential_fields: [{key: 'api_key', label: 'API key', secret: true}],
        unsupported_reason: 'OAuth is not supported.',
      });

    expect(parse).toThrow();
  });

  it('rejects a catalog entry whose support status disagrees with its provider id', () => {
    const parse = () =>
      modelProviderCatalogSeedSchema.parse({
        id: 'github-copilot',
        label: 'GitHub Copilot',
        support_status: 'supported',
        default_model: 'gpt-5.5-pro',
        credential_fields: [{key: 'api_key', label: 'API key', secret: true}],
        unsupported_reason: null,
      });

    expect(parse).toThrow();
  });

  it('keeps catalog ids unique and synced with provider id constants', () => {
    const supportedIds = MODEL_PROVIDER_CATALOG_SEED.filter(
      (entry) => entry.support_status === 'supported',
    ).map((entry) => entry.id);
    const unsupportedIds = MODEL_PROVIDER_CATALOG_SEED.filter(
      (entry) => entry.support_status === 'unsupported',
    ).map((entry) => entry.id);
    const ids = [...supportedIds, ...unsupportedIds];

    expect(supportedIds).toEqual([...SUPPORTED_MODEL_PROVIDER_IDS]);
    expect(unsupportedIds).toEqual([...UNSUPPORTED_MODEL_PROVIDER_IDS]);
    expect(ids).toEqual([...MODEL_PROVIDER_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('defines non-empty supported credential fields with at least one secret field', () => {
    const supportedEntries = MODEL_PROVIDER_CATALOG_SEED.filter(
      (entry) => entry.support_status === 'supported',
    );

    for (const entry of supportedEntries) {
      expect(entry.credential_fields.length).toBeGreaterThan(0);
      expect(entry.credential_fields.some((field) => field.secret)).toBe(true);
      for (const field of entry.credential_fields) {
        expect(field.key).not.toBe('');
        expect(field.label).not.toBe('');
        expect(typeof field.secret).toBe('boolean');
      }
    }
  });

  it('does not share credential field arrays between API-key providers', () => {
    const anthropic = getModelProviderEntry('anthropic');
    const openai = getModelProviderEntry('openai');
    if (anthropic === undefined || openai === undefined) {
      throw new Error('Missing API-key catalog entries');
    }
    const originalOpenAiFieldCount = openai.credential_fields.length;

    try {
      anthropic.credential_fields.push({key: 'extra', label: 'Extra', secret: true});

      expect(openai.credential_fields).toHaveLength(originalOpenAiFieldCount);
    } finally {
      anthropic.credential_fields.pop();
    }
  });

  it('parses catalog response entries assembled from seed entries and models', () => {
    const responseEntries = MODEL_PROVIDER_CATALOG_SEED.map((entry) => ({
      ...entry,
      models:
        entry.default_model === null
          ? []
          : [{id: entry.default_model, label: `${entry.label} default`}],
    }));

    const parsed = modelProviderCatalogEntrySchema.array().parse(responseEntries);

    expect(parsed).toHaveLength(37);
  });

  it('parses a managed provider response entry', () => {
    const parsed = modelProviderCatalogEntrySchema.parse(managedProviderCatalogEntry);

    expect(parsed.id).toBe('shipfox-managed');
  });

  it('parses enabled and disabled policies through the full catalog response', () => {
    for (const workspaceProviders of ['enabled', 'disabled'] as const) {
      const parsed = modelProviderCatalogResponseSchema.parse({
        providers: [managedProviderCatalogEntry],
        workspace_providers: workspaceProviders,
      });

      expect(parsed.workspace_providers).toBe(workspaceProviders);
    }
  });

  it('parses managed and instance default provider ids through the full catalog response', () => {
    const parsed = modelProviderCatalogResponseSchema.parse({
      providers: [managedProviderCatalogEntry],
      workspace_providers: 'enabled',
      managed_provider_id: 'shipfox-managed',
      instance_default_provider_id: 'anthropic',
    });

    expect(parsed.managed_provider_id).toBe('shipfox-managed');
    expect(parsed.instance_default_provider_id).toBe('anthropic');
  });

  it('accepts null ids and defaults them for responses from older servers', () => {
    const parsed = modelProviderCatalogResponseSchema.parse({
      providers: [managedProviderCatalogEntry],
      workspace_providers: 'enabled',
      managed_provider_id: null,
    });

    expect(parsed.managed_provider_id).toBeNull();
    expect(parsed.instance_default_provider_id).toBeNull();
  });

  it('rejects non-string provider ids in the full catalog response', () => {
    const parse = (ids: Record<string, unknown>) =>
      modelProviderCatalogResponseSchema.parse({
        providers: [managedProviderCatalogEntry],
        workspace_providers: 'enabled',
        managed_provider_id: null,
        instance_default_provider_id: null,
        ...ids,
      });

    expect(() => parse({managed_provider_id: 42})).toThrow();
    expect(() => parse({instance_default_provider_id: ''})).toThrow();
    expect(() => parse({managed_provider_id: 'not a provider ref'})).toThrow();
    expect(() => parse({instance_default_provider_id: 'ab'})).toThrow();
  });

  it('rejects an invalid workspace provider policy in the full catalog response', () => {
    const parse = () =>
      modelProviderCatalogResponseSchema.parse({
        providers: [managedProviderCatalogEntry],
        workspace_providers: 'invalid',
      });

    expect(parse).toThrow();
  });

  it('rejects a supported response entry without models', () => {
    const supportedEntry = getModelProviderEntry('openai');
    if (supportedEntry === undefined) throw new Error('Missing OpenAI catalog entry');

    const parse = () => modelProviderCatalogEntrySchema.parse({...supportedEntry, models: []});

    expect(parse).toThrow();
  });

  it('rejects a supported response entry whose default model is not in models', () => {
    const supportedEntry = getModelProviderEntry('openai');
    if (supportedEntry === undefined) throw new Error('Missing OpenAI catalog entry');

    const parse = () =>
      modelProviderCatalogEntrySchema.parse({
        ...supportedEntry,
        models: [{id: 'not-the-default', label: 'Not the default'}],
      });

    expect(parse).toThrow();
  });

  it('rejects an unsupported response entry with models', () => {
    const unsupportedEntry = getModelProviderEntry('github-copilot');
    if (unsupportedEntry === undefined) throw new Error('Missing Copilot catalog entry');

    const parse = () =>
      modelProviderCatalogEntrySchema.parse({
        ...unsupportedEntry,
        models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'}],
      });

    expect(parse).toThrow();
  });

  it('finds catalog entries and lists only supported providers', () => {
    const found = getModelProviderEntry('openai');
    const missing = getModelProviderEntry('missing-provider');
    const supportedEntries = listSupportedModelProviders();

    expect(found?.id).toBe('openai');
    expect(missing).toBeUndefined();
    expect(supportedEntries).toHaveLength(33);
    expect(supportedEntries.every((entry) => entry.support_status === 'supported')).toBe(true);
  });

  it('re-exports the instance-wide thinking contract', () => {
    const parsed = agentThinkingSchema.parse(DEFAULT_AGENT_THINKING);

    expect(parsed).toBe('xhigh');
  });
});
