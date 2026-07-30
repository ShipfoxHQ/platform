import {
  DEFAULT_HARNESS_TOOL_DEPLOYMENT_CONFIG,
  listEnabledHarnessTools,
  listHarnessDescriptors,
  MODEL_PROVIDER_CATALOG_SEED,
  MODEL_PROVIDER_IDS,
} from '@shipfox/api-agent-dto';
import type {AgentValidationCatalog} from '@shipfox/api-agent-dto/inter-module';

const piModelIdsByProvider = Object.fromEntries(
  MODEL_PROVIDER_CATALOG_SEED.filter((entry) => entry.support_status === 'supported').map(
    (entry) => [
      entry.id,
      entry.id === 'anthropic'
        ? ['claude-opus-4-8']
        : entry.id === 'openai'
          ? ['gpt-4.1', 'gpt-5.5-pro']
          : entry.default_model === null
            ? []
            : [entry.default_model],
    ],
  ),
);

export const agentValidationCatalog: AgentValidationCatalog = {
  version: 1,
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
