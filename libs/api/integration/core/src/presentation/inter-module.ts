import type {
  MaterializedAgentIntegrationConfigDto,
  MaterializedAgentIntegrationToolConfigDto,
} from '@shipfox/api-agent-dto';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModuleMethodContract,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import type {z} from 'zod';
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
  IntegrationConnectionProviderChangedError,
  IntegrationConnectionWorkspaceMismatchError,
  IntegrationProviderError,
  IntegrationProviderUnavailableError,
} from '#core/errors.js';
import {buildFixedEventProviders, buildProviderEventCatalogs} from '#core/event-catalogs.js';
import type {AgentToolCatalogEntry} from '#core/providers/agent-tools.js';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import type {IntegrationSourceControlService} from '#core/source-control-service.js';
import {
  createIntegrationToolCallRecorder,
  INVALID_METHOD_LABEL,
  type IntegrationToolCallAuditRecord,
  type IntegrationToolCallAuditTarget,
  type IntegrationToolCallCaller,
  type IntegrationToolCallRecorder,
  NO_METHOD_LABEL,
} from '#core/tool-call-audit.js';
import {
  callIntegrationTool,
  type IntegrationToolCallOutcome,
  loadAuthorizedToolConnection,
} from '#core/tool-call-service.js';
import {
  type GetIntegrationConnectionByIdFn,
  getIntegrationConnectionById,
  getIntegrationConnectionBySlug,
} from '#db/connections.js';

export function createIntegrationsInterModulePresentation(params: {
  registry: IntegrationProviderRegistry;
  sourceControl: IntegrationSourceControlService;
  getIntegrationConnectionById?: GetIntegrationConnectionByIdFn | undefined;
  /** Test seam that mirrors the MCP gateway's `recordCall`: audit and metrics must not affect outcomes. */
  createIntegrationToolCallRecorder?: (
    caller: IntegrationToolCallCaller,
  ) => IntegrationToolCallRecorder;
}): InterModulePresentation<typeof integrationsInterModuleContract> {
  const contract = integrationsInterModuleContract;
  const getConnectionById = params.getIntegrationConnectionById ?? getIntegrationConnectionById;
  const createRecorder =
    params.createIntegrationToolCallRecorder ?? createIntegrationToolCallRecorder;
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
    resolveConnection: async (input) => {
      const resolved = await getIntegrationConnectionBySlug(input);
      return resolved ? {id: resolved.id, provider: resolved.provider, slug: resolved.slug} : null;
    },
    resolveTriggerReference: async (input) =>
      await known(
        contract.methods.resolveTriggerReference,
        input,
        async () => await params.sourceControl.resolveTriggerReference(input),
      ),
    resolveSourceRef: async (input) =>
      await known(
        contract.methods.resolveSourceRef,
        input,
        async () => await params.sourceControl.resolveSourceRef(input),
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
          getConnectionById(input.defaultConnectionId),
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
          eventCatalogs: buildProviderEventCatalogs(params.registry),
          fixedEventProviders: buildFixedEventProviders(params.registry),
          defaultConnection: defaultConnection
            ? {
                id: defaultConnection.id,
                slug: defaultConnection.slug,
                provider: defaultConnection.provider,
              }
            : null,
        };
      }),
    callTool: async (input, context) => {
      const method = contract.methods.callTool;
      try {
        const connection = await loadAuthorizedToolConnection({
          workspaceId: input.workspaceId,
          connectionId: input.connectionId,
          provider: input.tool.provider,
          registry: params.registry,
          getIntegrationConnectionById: getConnectionById,
        });
        // The frozen tool is caller-supplied, so its id, method allowlist,
        // sensitivity, and requiredScope are re-validated against the live
        // catalog at call time: a tool or method removed after freezing is
        // rejected, and the executed entry is derived from the catalog.
        const catalogEntry = await resolveToolCatalogEntry(
          params.registry,
          input.tool.provider,
          input.tool.id,
        );
        const caller = toToolCallCaller(input.caller, input.workspaceId);
        const recorder = createRecorder(caller);

        if (catalogEntry === undefined) {
          recordToolCall(recorder, {
            arguments: input.arguments,
            method: NO_METHOD_LABEL,
            outcome: 'invalid-request',
            errorCode: 'invalid-request',
          });
          return {
            outcome: 'error',
            code: 'invalid-request',
            message: `Unknown integration tool: ${input.tool.id}`,
          };
        }

        // The executed method is the one the provider resolves from the
        // arguments (`input.arguments.method`), validated against the catalog
        // allowlist - the same rule the MCP gateway applies.
        const methodValidation = validateExecutedMethod(catalogEntry, input.arguments);
        if (methodValidation.kind === 'error') {
          recordToolCall(recorder, {
            arguments: input.arguments,
            method: INVALID_METHOD_LABEL,
            outcome: 'invalid-request',
            errorCode: 'invalid-request',
          });
          return {outcome: 'error', code: 'invalid-request', message: methodValidation.message};
        }

        const tool = toolFromCatalogEntry(catalogEntry);
        const integration: MaterializedAgentIntegrationConfigDto = {
          connectionId: input.connectionId,
          connectionSlug: connection.slug,
          provider: input.tool.provider,
          requiredScope: tool.requiredScope,
          tools: [tool],
        };
        const target: IntegrationToolCallAuditTarget = {
          connection,
          integration,
          tool,
        };
        const executedMethod = methodValidation.method;

        const outcome = await callIntegrationTool({
          registry: params.registry,
          connection,
          integration,
          tool,
          description: catalogEntry.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          arguments: input.arguments,
          method: executedMethod,
          caller,
          signal: context.signal,
        });

        recordCallOutcome(
          recorder,
          target,
          input.arguments,
          executedMethod ?? NO_METHOD_LABEL,
          outcome,
        );
        return toCallToolOutput(outcome);
      } catch (error) {
        throw mapError(method, input, error);
      }
    },
  });
}

/** The caller shape as parsed from the published contract, so it cannot drift. */
type CallToolCaller = z.output<
  typeof integrationsInterModuleContract.methods.callTool.input.shape.caller
>;

function toToolCallCaller(caller: CallToolCaller, workspaceId: string): IntegrationToolCallCaller {
  return caller.kind === 'agent'
    ? {caller: 'agent'}
    : {
        caller: 'tool_step',
        workspaceId,
        runId: caller.runId,
        jobExecutionId: caller.jobExecutionId,
        stepId: caller.stepId,
        stepAttempt: caller.stepAttempt,
        callIndex: caller.callIndex,
      };
}

async function resolveToolCatalogEntry(
  registry: IntegrationProviderRegistry,
  provider: string,
  toolId: string,
): Promise<AgentToolCatalogEntry | undefined> {
  const catalog = await registry.getAdapter(provider, 'agent_tools').catalog();
  return catalog.find((entry) => entry.id === toolId);
}

function toolFromCatalogEntry(
  entry: AgentToolCatalogEntry,
): MaterializedAgentIntegrationToolConfigDto {
  return {
    id: entry.id,
    sensitivity: entry.sensitivity,
    sensitive: entry.sensitive,
    requiredScope: entry.requiredScope as unknown[],
    inputSchema: entry.inputSchema,
    ...(entry.outputSchema === undefined ? {} : {outputSchema: entry.outputSchema}),
    ...(entry.methods === undefined
      ? {}
      : {
          methods: entry.methods.map((candidate) => ({
            id: candidate.id,
            token: `${entry.id}.${candidate.id}`,
            description: candidate.description,
            sensitivity: candidate.sensitivity,
            sensitive: candidate.sensitive,
            requiredScope: candidate.requiredScope as unknown[],
          })),
        }),
  };
}

function validateExecutedMethod(
  entry: AgentToolCatalogEntry,
  args: Record<string, unknown>,
): {kind: 'ok'; method?: string | undefined} | {kind: 'error'; message: string} {
  if (!entry.methods) return {kind: 'ok'};
  const method = args.method;
  if (typeof method !== 'string') {
    return {kind: 'error', message: 'Method-family tools require a string method argument'};
  }
  if (!entry.methods.some((candidate) => candidate.id === method)) {
    return {kind: 'error', message: `Unauthorized integration tool method: ${method}`};
  }
  return {kind: 'ok', method};
}

/** Audit and metrics must not affect inter-module tool call outcomes. */
function recordToolCall(
  recorder: IntegrationToolCallRecorder,
  record: IntegrationToolCallAuditRecord,
): void {
  try {
    recorder(record);
  } catch (error) {
    logger().error({err: error}, 'Failed to record integration agent tool audit event');
    reportError(error, {boundary: 'integration.agent-tool', operation: 'audit'});
  }
}

function recordCallOutcome(
  recorder: IntegrationToolCallRecorder,
  target: IntegrationToolCallAuditTarget,
  argumentsValue: unknown,
  method: string,
  outcome: IntegrationToolCallOutcome,
): void {
  recorder({
    authorizedTool: target,
    arguments: argumentsValue,
    method,
    outcome: outcome.outcome === 'success' ? 'success' : 'tool-error',
    errorCode: outcome.outcome === 'success' ? 'none' : outcome.error.code,
    ...(outcome.outcome === 'success' || outcome.error.status === undefined
      ? {}
      : {providerStatus: outcome.error.status}),
  });
}

type CallToolOutput =
  | {
      outcome: 'success';
      result: Record<string, unknown> | null;
      content: Record<string, unknown>[];
    }
  | {
      outcome: 'error';
      code: string;
      message: string;
      retryAfterSeconds?: number | undefined;
      status?: number | undefined;
    };

function toCallToolOutput(outcome: IntegrationToolCallOutcome): CallToolOutput {
  return outcome.outcome === 'success'
    ? {
        outcome: 'success',
        result: outcome.result.structuredContent ?? null,
        content: outcome.result.content,
      }
    : {
        outcome: 'error',
        code: outcome.error.code,
        message: outcome.error.message,
        ...(outcome.error.retryAfterSeconds === undefined
          ? {}
          : {retryAfterSeconds: outcome.error.retryAfterSeconds}),
        ...(outcome.error.status === undefined ? {} : {status: outcome.error.status}),
      };
}

async function known<Output>(
  method: InterModuleMethodContract,
  input: {connectionId?: string; defaultConnectionId?: string; ref?: string | undefined},
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
  input: {connectionId?: string; defaultConnectionId?: string; ref?: string | undefined},
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
  if (error instanceof IntegrationConnectionProviderChangedError)
    return createInterModuleKnownError(method, 'connection-provider-changed', {
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
  if (error instanceof IntegrationProviderError) {
    // Only methods that resolve refs declare these codes; other methods keep
    // seeing the failure as a generic provider failure.
    if (error.reason === 'ref-not-found' && 'ref-not-found' in method.errors) {
      return createInterModuleKnownError(method, 'ref-not-found', refDetails(input));
    }
    if (error.reason === 'ref-invalid' && 'ref-invalid' in method.errors) {
      return createInterModuleKnownError(method, 'ref-invalid', refDetails(input));
    }
    if ('provider-failure' in method.errors) {
      return createInterModuleKnownError(method, 'provider-failure', {
        reason: error.reason,
        ...(error.retryAfterSeconds === undefined
          ? {}
          : {retryAfterSeconds: error.retryAfterSeconds}),
      });
    }
    return error;
  }
  return error;
}

function refDetails(input: {ref?: string | undefined}): {ref: string} {
  if (input.ref === undefined) {
    throw new Error('Ref error mapping requires a ref input');
  }
  return {ref: input.ref};
}
