import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModuleMethodContract,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {
  buildAgentToolCatalogs,
  buildAgentToolSelectionCatalogs,
  createWorkspaceConnectionSnapshotLoader,
} from '#core/agent-tool-selection.js';
import {
  IntegrationCapabilityUnavailableError,
  IntegrationCheckoutUnsupportedError,
  IntegrationConnectionInactiveError,
  IntegrationConnectionNotFoundError,
  IntegrationConnectionWorkspaceMismatchError,
  IntegrationProviderError,
  IntegrationProviderUnavailableError,
} from '#core/errors.js';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import type {IntegrationSourceControlService} from '#core/source-control-service.js';
import {getIntegrationConnectionById} from '#db/connections.js';

export function createIntegrationsInterModulePresentation(params: {
  registry: IntegrationProviderRegistry;
  sourceControl: IntegrationSourceControlService;
}): InterModulePresentation<typeof integrationsInterModuleContract> {
  const contract = integrationsInterModuleContract;
  return defineInterModulePresentation(contract, {
    resolveSourceRepository: async (input) =>
      await known(contract.methods.resolveSourceRepository, input, async () => {
        const resolved = await params.sourceControl.resolveRepository(input);
        return {
          connection: {
            id: resolved.connection.id,
            provider: resolved.connection.provider,
            slug: resolved.connection.slug,
          },
          repository: resolved.repository,
        };
      }),
    resolveTriggerReference: async (input) =>
      await known(
        contract.methods.resolveTriggerReference,
        input,
        async () => await params.sourceControl.resolveTriggerReference(input),
      ),
    listSourceFiles: async (input) =>
      await known(
        contract.methods.listSourceFiles,
        input,
        async () => await params.sourceControl.listFiles(input),
      ),
    fetchSourceFile: async (input) =>
      await known(
        contract.methods.fetchSourceFile,
        input,
        async () => await params.sourceControl.fetchFile(input),
      ),
    createCheckoutSpec: async (input) =>
      await known(contract.methods.createCheckoutSpec, input, async () => {
        const spec = await params.sourceControl.createCheckoutSpec(input);
        return {
          repositoryUrl: spec.repositoryUrl,
          ref: spec.ref,
          ...(spec.credentials
            ? {
                credentials: {
                  ...spec.credentials,
                  expiresAt: spec.credentials.expiresAt.toISOString(),
                },
              }
            : {}),
          ...(spec.gitAuthor === undefined ? {} : {gitAuthor: spec.gitAuthor}),
        };
      }),
    getAgentToolsContext: async (input) =>
      await known(contract.methods.getAgentToolsContext, input, async () => {
        const [selectionCatalogs, catalogs, snapshot, defaultConnection] = await Promise.all([
          buildAgentToolSelectionCatalogs(params.registry),
          buildAgentToolCatalogs(params.registry),
          createWorkspaceConnectionSnapshotLoader(params.registry)(input.workspaceId),
          getIntegrationConnectionById(input.defaultConnectionId),
        ]);
        return {
          selectionCatalogs: [...selectionCatalogs].map(([provider, value]) => ({
            provider,
            selectors: value.selectors.map((selector) => ({...selector})),
          })),
          catalogs: [...catalogs].map(([provider, tools]) => ({
            provider,
            tools: tools.map(({methods, ...tool}) => ({
              ...tool,
              ...(methods === undefined ? {} : {methods: methods.map((method) => ({...method}))}),
            })),
          })),
          workspaceConnections: [...snapshot].map(([slug, value]) => ({
            slug,
            ...value,
            capabilities: [...value.capabilities],
          })),
          defaultConnection: defaultConnection
            ? {
                id: defaultConnection.id,
                slug: defaultConnection.slug,
                provider: defaultConnection.provider,
              }
            : null,
        };
      }),
  });
}

async function known<Output>(
  method: InterModuleMethodContract,
  input: {connectionId?: string; defaultConnectionId?: string},
  operation: () => Promise<Output>,
): Promise<Output> {
  try {
    return await operation();
  } catch (error) {
    throw mapError(method, input, error);
  }
}
function mapError(
  method: InterModuleMethodContract,
  input: {connectionId?: string; defaultConnectionId?: string},
  error: unknown,
): unknown {
  if (error instanceof IntegrationConnectionNotFoundError)
    return createInterModuleKnownError(method, 'connection-not-found', {
      connectionId: input.connectionId ?? input.defaultConnectionId,
    });
  if (error instanceof IntegrationConnectionInactiveError)
    return createInterModuleKnownError(method, 'connection-inactive', {
      connectionId: input.connectionId,
    });
  if (error instanceof IntegrationConnectionWorkspaceMismatchError)
    return createInterModuleKnownError(method, 'connection-workspace-mismatch', {
      connectionId: input.connectionId,
    });
  if (error instanceof IntegrationProviderUnavailableError)
    return createInterModuleKnownError(method, 'provider-unavailable', {provider: error.provider});
  if (error instanceof IntegrationCapabilityUnavailableError)
    return createInterModuleKnownError(method, 'capability-unavailable', {
      provider: error.provider,
      capability: error.capability,
    });
  if (error instanceof IntegrationCheckoutUnsupportedError)
    return createInterModuleKnownError(method, 'checkout-unsupported', {provider: error.provider});
  if (error instanceof IntegrationProviderError)
    return createInterModuleKnownError(method, 'provider-failure', {
      reason: error.reason,
      ...(error.retryAfterSeconds === undefined
        ? {}
        : {retryAfterSeconds: error.retryAfterSeconds}),
    });
  return error;
}
