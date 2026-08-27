import {
  DEFAULT_HARNESS_TOOL_DEPLOYMENT_CONFIG,
  listEnabledHarnessTools,
  listHarnessDescriptors,
  MODEL_PROVIDER_CATALOG_SEED,
  MODEL_PROVIDER_IDS,
} from '@shipfox/api-agent-dto';
import type {
  AgentInterModuleClient,
  AgentValidationCatalog,
  AgentValidationCatalogV2,
} from '@shipfox/api-agent-dto/inter-module';
import {agentThinkingSchema} from '@shipfox/workflow-document';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';

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
    thinking_levels: [...harness.thinkingLevels],
    effective_tools: listEnabledHarnessTools(
      harness.id,
      DEFAULT_HARNESS_TOOL_DEPLOYMENT_CONFIG,
    ).map((tool) => tool.name),
  })),
};

export const agentValidationCatalogV2: AgentValidationCatalogV2 = {
  ...agentValidationCatalog,
  version: 2,
  default_harness_id: 'pi',
};

export const agentTestClient: AgentInterModuleClient = {
  getValidationCatalog() {
    return Promise.resolve(agentValidationCatalog);
  },
  getValidationCatalogV2() {
    return Promise.resolve(agentValidationCatalogV2);
  },
  resolveAgentConfig({config}) {
    return Promise.resolve(resolveTestAgentDefaults(config));
  },
  resolveRuntimeCredentials({harness, provider, model, thinking}) {
    return Promise.resolve({
      harness,
      provider_id: provider,
      model,
      thinking,
      credentials: {api_key: 'test-agent-credential'},
    });
  },
  claimSession: vi.fn(),
  carryOverSessions: vi.fn(),
};

export const resolveTestAgentDefaults: AgentDefaultsResolver = (config) => {
  const provider = config.provider ?? 'anthropic';
  return {
    harness: config.harness ?? 'pi',
    provider,
    model: config.model ?? (provider === 'openai' ? 'gpt-5.5-pro' : 'claude-opus-4-8'),
    thinking: agentThinkingSchema.safeParse(config.thinking).data ?? 'xhigh',
  };
};
