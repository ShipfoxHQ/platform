import type {
  Harness,
  HarnessDescriptor,
  ManagedModelProvider,
  WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
import {
  DEFAULT_HARNESS,
  listEnabledHarnessTools,
  listHarnessDescriptors,
  MODEL_PROVIDER_IDS,
} from '@shipfox/api-agent-dto';
import type {
  AgentValidationCatalog,
  AgentValidationCatalogV2,
} from '@shipfox/api-agent-dto/inter-module';
import {harnessToolDeploymentConfig} from '#config.js';
import {listHarnessProviderModels} from './harness/index.js';
import {getModelProviderEntry} from './model-provider-policy.js';

type HarnessValidationCatalog = AgentValidationCatalog['harnesses'][number];

/** Produces the versioned, JSON-safe policy snapshot consumed by Definitions. */
export function getAgentValidationCatalog(
  managedProvider?: ManagedModelProvider | undefined,
  workspaceProviders: WorkspaceProvidersPolicy = 'enabled',
): AgentValidationCatalog {
  const managedOnly = workspaceProviders === 'disabled';

  return {
    version: 1,
    providers: buildValidationProviders(managedProvider, managedOnly),
    harnesses: listHarnessDescriptors().map((harness) =>
      buildHarnessValidationCatalog(harness, managedProvider, managedOnly),
    ),
  };
}

export function getAgentValidationCatalogV2(
  managedProvider?: ManagedModelProvider | undefined,
  workspaceProviders: WorkspaceProvidersPolicy = 'enabled',
  defaultHarnessId: Harness = DEFAULT_HARNESS,
): AgentValidationCatalogV2 {
  return {
    ...getAgentValidationCatalog(managedProvider, workspaceProviders),
    version: 2,
    default_harness_id: defaultHarnessId,
  };
}

function buildValidationProviders(
  managedProvider: ManagedModelProvider | undefined,
  managedOnly: boolean,
): AgentValidationCatalog['providers'] {
  const providers: AgentValidationCatalog['providers'] = [];

  if (!managedOnly) {
    providers.push(
      ...MODEL_PROVIDER_IDS.map((id) => ({
        id,
        support_status: getModelProviderEntry(id)?.support_status ?? 'unsupported',
      })),
    );
  }

  if (managedProvider !== undefined) {
    providers.push({id: managedProvider.id, support_status: 'supported'});
  }

  return providers;
}

function buildHarnessValidationCatalog(
  harness: HarnessDescriptor,
  managedProvider: ManagedModelProvider | undefined,
  managedOnly: boolean,
): HarnessValidationCatalog {
  const managedModels = getManagedModelsForHarness(harness, managedProvider);

  return {
    id: harness.id,
    supported_provider_ids: buildSupportedProviderIds(
      harness,
      managedProvider,
      managedModels,
      managedOnly,
    ),
    model_ids_by_provider: buildModelIdsByProvider(
      harness,
      managedProvider,
      managedModels,
      managedOnly,
    ),
    thinking_levels: [...harness.thinkingLevels],
    effective_tools: listEnabledHarnessTools(harness.id, harnessToolDeploymentConfig).map(
      (tool) => tool.name,
    ),
  };
}

function buildSupportedProviderIds(
  harness: HarnessDescriptor,
  managedProvider: ManagedModelProvider | undefined,
  managedModels: ManagedModelProvider['models'],
  managedOnly: boolean,
): string[] {
  if (managedOnly) {
    if (managedProvider === undefined || managedModels.length === 0) return [];
    return [managedProvider.id];
  }

  const providerIds = [...harness.supportedProviderIds];
  if (managedProvider !== undefined && managedModels.length > 0) {
    providerIds.push(managedProvider.id);
  }
  return providerIds;
}

function buildModelIdsByProvider(
  harness: HarnessDescriptor,
  managedProvider: ManagedModelProvider | undefined,
  managedModels: ManagedModelProvider['models'],
  managedOnly: boolean,
): Record<string, string[]> {
  const modelIdsByProvider: Record<string, string[]> = {};

  if (!managedOnly) {
    for (const providerId of harness.supportedProviderIds) {
      modelIdsByProvider[providerId] = listHarnessProviderModels(harness.id, providerId).map(
        (model) => model.id,
      );
    }
  }

  if (managedProvider !== undefined) {
    modelIdsByProvider[managedProvider.id] = managedModels.map((model) => model.id);
  }

  return modelIdsByProvider;
}

function getManagedModelsForHarness(
  harness: HarnessDescriptor,
  managedProvider: ManagedModelProvider | undefined,
): ManagedModelProvider['models'] {
  if (managedProvider === undefined) return [];
  return managedModelsForHarness(harness.id, managedProvider);
}

function managedModelsForHarness(
  harness: 'pi' | 'claude',
  managedProvider: ManagedModelProvider,
): ManagedModelProvider['models'] {
  if (harness === 'pi') return managedProvider.models;
  return managedProvider.models.filter((model) => model.api === 'anthropic-messages');
}
