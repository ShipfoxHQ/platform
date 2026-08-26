import type {ManagedModelProvider} from '@shipfox/api-agent-dto';
import {getAgentValidationCatalog} from './validation-catalog.js';

describe('getAgentValidationCatalog', () => {
  it('includes the model allowlist for each harness/provider pair', () => {
    const catalog = getAgentValidationCatalog();
    const pi = catalog.harnesses.find((harness) => harness.id === 'pi');
    const claude = catalog.harnesses.find((harness) => harness.id === 'claude');

    expect(Object.keys(pi?.model_ids_by_provider ?? {})).toEqual(
      expect.arrayContaining(pi?.supported_provider_ids ?? []),
    );
    expect(pi?.model_ids_by_provider?.anthropic).toContain('claude-opus-4-8');
    expect(pi?.model_ids_by_provider?.baseten).toContain('zai-org/GLM-5.2');
    expect(pi?.model_ids_by_provider?.openai).toContain('gpt-5.5-pro');
    expect(pi?.model_ids_by_provider?.['qwen-token-plan-individual']).toContain('qwen3.8-max');
    expect(pi?.thinking_levels).toContain('max');
    expect(claude?.model_ids_by_provider?.anthropic).toContain('claude-opus-4-8');
  });

  it('includes injected managed providers with harness-compatible models', () => {
    const managedProvider = {
      id: 'shipfox-managed',
      label: 'Shipfox Managed',
      models: [
        {id: 'managed-claude', label: 'Managed Claude', api: 'anthropic-messages' as const},
        {id: 'managed-responses', label: 'Managed Responses', api: 'openai-responses' as const},
      ],
      defaultModel: 'managed-claude',
      resolveCredentials: async () => ({
        api: 'anthropic-messages' as const,
        baseUrl: 'https://gateway.example.com',
        credentials: {api_key: 'token'},
      }),
    } satisfies ManagedModelProvider;

    const catalog = getAgentValidationCatalog(managedProvider);
    const pi = catalog.harnesses.find((harness) => harness.id === 'pi');
    const claude = catalog.harnesses.find((harness) => harness.id === 'claude');

    expect(catalog.providers).toContainEqual({id: managedProvider.id, support_status: 'supported'});
    expect(pi?.supported_provider_ids).toContain(managedProvider.id);
    expect(pi?.model_ids_by_provider?.[managedProvider.id]).toEqual([
      'managed-claude',
      'managed-responses',
    ]);
    expect(claude?.supported_provider_ids).toContain(managedProvider.id);
    expect(claude?.model_ids_by_provider?.[managedProvider.id]).toEqual(['managed-claude']);
  });

  it('exposes only the managed provider when workspace providers are disabled', () => {
    const managedProvider = {
      id: 'shipfox-managed',
      label: 'Shipfox Managed',
      models: [{id: 'managed-claude', label: 'Managed Claude', api: 'anthropic-messages' as const}],
      defaultModel: 'managed-claude',
      resolveCredentials: async () => ({
        api: 'anthropic-messages' as const,
        baseUrl: 'https://gateway.example.com',
        credentials: {api_key: 'token'},
      }),
    } satisfies ManagedModelProvider;

    const catalog = getAgentValidationCatalog(managedProvider, 'disabled');

    expect(catalog.providers).toEqual([{id: managedProvider.id, support_status: 'supported'}]);
    expect(
      catalog.harnesses.every((harness) =>
        harness.supported_provider_ids.every((providerId) => providerId === managedProvider.id),
      ),
    ).toBe(true);
  });
});
