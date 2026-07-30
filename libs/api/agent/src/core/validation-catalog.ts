import {
  listEnabledHarnessTools,
  listHarnessDescriptors,
  MODEL_PROVIDER_IDS,
} from '@shipfox/api-agent-dto';
import type {AgentValidationCatalog} from '@shipfox/api-agent-dto/inter-module';
import {harnessToolDeploymentConfig} from '#config.js';
import {listHarnessProviderModels} from './harness/index.js';
import {getModelProviderEntry} from './model-provider-policy.js';

/** Produces the versioned, JSON-safe policy snapshot consumed by Definitions. */
export function getAgentValidationCatalog(): AgentValidationCatalog {
  return {
    version: 1,
    providers: MODEL_PROVIDER_IDS.map((id) => ({
      id,
      support_status: getModelProviderEntry(id)?.support_status ?? 'unsupported',
    })),
    harnesses: listHarnessDescriptors().map((harness) => ({
      id: harness.id,
      supported_provider_ids: [...harness.supportedProviderIds],
      model_ids_by_provider: Object.fromEntries(
        harness.supportedProviderIds.map((providerId) => [
          providerId,
          listHarnessProviderModels(harness.id, providerId).map((model) => model.id),
        ]),
      ),
      thinking_levels: [...harness.thinkingLevels],
      effective_tools: listEnabledHarnessTools(harness.id, harnessToolDeploymentConfig).map(
        (tool) => tool.name,
      ),
    })),
  };
}
