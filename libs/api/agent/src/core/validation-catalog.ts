import type {ManagedModelProvider} from '@shipfox/api-agent-dto';
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
export function getAgentValidationCatalog(
  managedProvider?: ManagedModelProvider | undefined,
): AgentValidationCatalog {
  const providers = [
    ...MODEL_PROVIDER_IDS.map((id) => ({
      id,
      support_status: getModelProviderEntry(id)?.support_status ?? 'unsupported',
    })),
    ...(managedProvider === undefined
      ? []
      : [{id: managedProvider.id, support_status: 'supported' as const}]),
  ];

  return {
    version: 1,
    providers,
    harnesses: listHarnessDescriptors().map((harness) => ({
      id: harness.id,
      supported_provider_ids: [
        ...harness.supportedProviderIds,
        ...(managedProvider !== undefined &&
        managedModelsForHarness(harness.id, managedProvider).length > 0
          ? [managedProvider.id]
          : []),
      ],
      model_ids_by_provider: Object.fromEntries([
        ...harness.supportedProviderIds.map((providerId) => [
          providerId,
          listHarnessProviderModels(harness.id, providerId).map((model) => model.id),
        ]),
        ...(managedProvider === undefined
          ? []
          : [
              [
                managedProvider.id,
                managedModelsForHarness(harness.id, managedProvider).map((model) => model.id),
              ],
            ]),
      ]),
      thinking_levels: [...harness.thinkingLevels],
      effective_tools: listEnabledHarnessTools(harness.id, harnessToolDeploymentConfig).map(
        (tool) => tool.name,
      ),
    })),
  };
}

function managedModelsForHarness(
  harness: 'pi' | 'claude',
  managedProvider: ManagedModelProvider,
): ManagedModelProvider['models'] {
  if (harness === 'pi') return managedProvider.models;
  return managedProvider.models.filter((model) => model.api === 'anthropic-messages');
}
