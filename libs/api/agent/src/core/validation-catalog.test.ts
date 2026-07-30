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
    expect(pi?.model_ids_by_provider?.openai).toContain('gpt-5.5-pro');
    expect(claude?.model_ids_by_provider?.anthropic).toContain('claude-opus-4-8');
  });
});
