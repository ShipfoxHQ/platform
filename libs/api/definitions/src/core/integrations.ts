import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';

export type DefinitionsSourceControl = {
  resolveRepository: IntegrationsModuleClient['resolveSourceRepository'];
  listFiles: IntegrationsModuleClient['listSourceFiles'];
  fetchFile: IntegrationsModuleClient['fetchSourceFile'];
};

export function createDefinitionsSourceControl(
  integrations: IntegrationsModuleClient,
): DefinitionsSourceControl {
  return {
    resolveRepository: integrations.resolveSourceRepository,
    listFiles: integrations.listSourceFiles,
    fetchFile: integrations.fetchSourceFile,
  };
}

export async function loadIntegrationValidationContext(
  integrations: IntegrationsModuleClient,
  workspaceId: string,
  defaultConnectionId: string,
  signal?: AbortSignal,
) {
  const input = {workspaceId, defaultConnectionId};
  const context =
    signal === undefined
      ? await integrations.getAgentToolsContext(input)
      : await integrations.getAgentToolsContext(input, {signal});
  return {
    agentToolSelectionCatalogs: new Map(
      context.selectionCatalogs.map(({provider, selectors}) => [provider, {selectors}]),
    ),
    workspaceConnectionSnapshot: new Map(
      context.workspaceConnections.map(({slug, ...connection}) => [slug, connection]),
    ),
    eventCatalogs: new Map(
      context.eventCatalogs.map(({provider, events}) => [provider, new Set(events)]),
    ),
    fixedEventProviders: new Set(context.fixedEventProviders),
    defaultConnectionSlug: context.defaultConnection?.slug,
  };
}

export {integrationsInterModuleContract};
