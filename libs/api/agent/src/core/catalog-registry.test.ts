import {getModels, getProviders} from '@earendil-works/pi-ai/compat';
import {
  MODEL_PROVIDER_CATALOG_SEED,
  MODEL_PROVIDER_IDS,
  type ModelProviderId,
  SUPPORTED_MODEL_PROVIDER_IDS,
} from '@shipfox/api-agent-dto';
import {getModelProviderEntry, isReservedModelProviderId} from './model-provider-policy.js';

const STORE_COMPATIBLE_CREDENTIAL_KEY_PATTERN = /^[a-z_][a-z0-9_]*$/;

describe('model provider catalog registry', () => {
  it('keeps catalog provider ids synced with the pinned Pi provider registry', () => {
    const catalogModelProviderIds = [...MODEL_PROVIDER_IDS].sort();
    const piModelProviderIds = getProviders().sort();

    expect(catalogModelProviderIds).toEqual(piModelProviderIds);
  });

  it('keeps the Agent reserved-provider helper aligned with every known provider ID', () => {
    const reservedProviderIds = MODEL_PROVIDER_IDS.filter(isReservedModelProviderId).sort();

    expect(reservedProviderIds).toEqual([...MODEL_PROVIDER_IDS].sort());
    expect(isReservedModelProviderId('custom-provider')).toBe(false);
  });

  it('keeps supported catalog default models present in the pinned Pi model registry', () => {
    const supportedEntries = MODEL_PROVIDER_CATALOG_SEED.filter(
      (entry) => entry.support_status === 'supported',
    );

    const missingDefaults = supportedEntries.flatMap((entry) => {
      const piModels = getModels(entry.id as Parameters<typeof getModels>[0]);
      const defaultExists = piModels.some((model) => model.id === entry.default_model);
      return defaultExists ? [] : [formatMissingDefault(entry.id, entry.default_model)];
    });

    expect(missingDefaults).toEqual([]);
  });

  it('keeps supported credential field keys compatible with the agent secrets namespace', () => {
    const invalidKeys = SUPPORTED_MODEL_PROVIDER_IDS.flatMap((providerId) => {
      const entry = getModelProviderEntry(providerId);
      return (entry?.credential_fields ?? [])
        .filter((field) => !STORE_COMPATIBLE_CREDENTIAL_KEY_PATTERN.test(field.key))
        .map((field) => `${providerId}:${field.key}`);
    });

    expect(invalidKeys).toEqual([]);
  });
});

function formatMissingDefault(providerId: ModelProviderId, defaultModel: string | null): string {
  return `${providerId}:${defaultModel ?? '<null>'}`;
}
