import {
  DEFAULT_HARNESS_TOOL_DEPLOYMENT_CONFIG,
  listEnabledHarnessTools,
  listHarnessDescriptors,
  MODEL_PROVIDER_CATALOG_SEED,
  MODEL_PROVIDER_IDS,
} from '@shipfox/api-agent-dto';
import type {AgentValidationCatalogV2} from '@shipfox/api-agent-dto/inter-module';

function modelsForProvider(entry: (typeof MODEL_PROVIDER_CATALOG_SEED)[number]): string[] {
  if (entry.id === 'anthropic') return ['claude-opus-4-8'];
  if (entry.id === 'openai') return ['gpt-4.1', 'gpt-5.5-pro'];
  if (entry.default_model === null) return [];
  return [entry.default_model];
}

const piModelIdsByProvider = Object.fromEntries(
  MODEL_PROVIDER_CATALOG_SEED.filter((entry) => entry.support_status === 'supported').map(
    (entry) => [entry.id, modelsForProvider(entry)],
  ),
);

export const agentValidationCatalog: AgentValidationCatalogV2 = {
  version: 2,
  default_harness_id: 'pi',
  providers: MODEL_PROVIDER_IDS.map((id) => ({
    id,
    support_status:
      MODEL_PROVIDER_CATALOG_SEED.find((entry) => entry.id === id)?.support_status ?? 'unsupported',
  })),
  harnesses: listHarnessDescriptors().map((harness) => ({
    id: harness.id,
    supported_provider_ids: [...harness.supportedProviderIds],
    model_ids_by_provider:
      harness.id === 'pi' ? piModelIdsByProvider : {anthropic: ['claude-opus-4-8']},
    thinking_levels: [...harness.thinkingLevels],
    effective_tools: listEnabledHarnessTools(
      harness.id,
      DEFAULT_HARNESS_TOOL_DEPLOYMENT_CONFIG,
    ).map((tool) => tool.name),
  })),
};
