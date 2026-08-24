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
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import type {IntegrationSourceControlService} from '#core/source-control-service.js';
import {
  createIntegrationToolCallRecorder,
  INVALID_METHOD_LABEL,
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
}): InterModulePresentation<typeof integrationsInterModuleContract> {
  const contract = integrationsInterModuleContract;
  const getConnectionById = params.getIntegrationConnectionById ?? getIntegrationConnectionById;
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
        const integration: MaterializedAgentIntegrationConfigDto = {
          connectionId: input.connectionId,
          connectionSlug: connection.slug,
          provider: input.tool.provider,
          requiredScope: input.tool.requiredScope,
          tools: [toolConfig(input.tool)],
        };
        const caller = toToolCallCaller(input.caller, input.workspaceId);
        const recorder = createIntegrationToolCallRecorder(caller);
        const target: IntegrationToolCallAuditTarget = {
          connection,
          integration,
          tool: toolConfig(input.tool),
        };

        const methodValidation = validateFrozenToolMethod(input.tool);
        if (methodValidation.kind === 'error') {
          recorder({
            authorizedTool: target,
            arguments: input.arguments,
            method: INVALID_METHOD_LABEL,
            outcome: 'invalid-request',
            errorCode: 'invalid-request',
          });
          return {outcome: 'error', code: 'invalid-request', message: methodValidation.message};
        }

        const outcome = await callIntegrationTool({
          registry: params.registry,
          connection,
          integration,
          tool: toolConfig(input.tool),
          description: input.tool.id,
          inputSchema: input.tool.inputSchema,
          outputSchema: input.tool.outputSchema,
          arguments: input.arguments,
          method: input.tool.method,
          caller,
          signal: callSignal(context.signal, input.timeoutMs),
        });

        recordCallOutcome(
          recorder,
          target,
          input.arguments,
          input.tool.method ?? NO_METHOD_LABEL,
          outcome,
        );
        return toCallToolOutput(outcome);
      } catch (error) {
        throw mapToolCallError(method, input, error);
      }
    },
  });
}

interface FrozenToolMethod {
  id: string;
  token: string;
  description?: string | undefined;
  sensitivity: 'read' | 'write';
  sensitive: boolean;
  requiredScope: unknown[];
}

interface FrozenTool {
  id: string;
  method?: string | undefined;
  sensitivity: 'read' | 'write';
  sensitive: boolean;
  requiredScope: unknown[];
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | undefined;
  methods?: readonly FrozenToolMethod[] | undefined;
}

type FrozenToolCaller =
  | {kind: 'agent'}
  | {
      kind: 'tool_step';
      runId: string;
      jobExecutionId: string;
      stepId: string;
      stepAttempt: number;
      callIndex: number;
    };

function toolConfig(tool: FrozenTool): MaterializedAgentIntegrationToolConfigDto {
  return {
    id: tool.id,
    sensitivity: tool.sensitivity,
    sensitive: tool.sensitive,
    requiredScope: tool.requiredScope,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema === undefined ? {} : {outputSchema: tool.outputSchema}),
    ...(tool.methods === undefined
      ? {}
      : {
          methods: tool.methods.map((candidate) => ({...candidate})),
        }),
  };
}

function toToolCallCaller(
  caller: FrozenToolCaller,
  workspaceId: string,
): IntegrationToolCallCaller {
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

function validateFrozenToolMethod(
  tool: FrozenTool,
): {kind: 'ok'} | {kind: 'error'; message: string} {
  if (!tool.methods) return {kind: 'ok'};
  if (tool.method === undefined) {
    return {kind: 'error', message: 'Method-family tools require a frozen method'};
  }
  if (!tool.methods.some((candidate) => candidate.id === tool.method)) {
    return {kind: 'error', message: `Unauthorized integration tool method: ${tool.method}`};
  }
  return {kind: 'ok'};
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

function callSignal(signal: AbortSignal, timeoutMs: number | undefined): AbortSignal {
  return timeoutMs === undefined
    ? signal
    : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

function mapToolCallError(
  method: InterModuleMethodContract,
  input: {connectionId: string},
  error: unknown,
): unknown {
  if (error instanceof IntegrationConnectionNotFoundError)
    return createInterModuleKnownError(method, 'connection-not-found', {
      connectionId: input.connectionId,
    });
  if (error instanceof IntegrationConnectionWorkspaceMismatchError)
    return createInterModuleKnownError(method, 'connection-workspace-mismatch', {
      connectionId: input.connectionId,
    });
  if (error instanceof IntegrationConnectionInactiveError)
    return createInterModuleKnownError(method, 'connection-inactive', {
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
  return error;
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
    return createInterModuleKnownError(method, 'provider-failure', {
      reason: error.reason,
      ...(error.retryAfterSeconds === undefined
        ? {}
        : {retryAfterSeconds: error.retryAfterSeconds}),
    });
  }
  return error;
}

function refDetails(input: {ref?: string | undefined}): {ref: string} {
  if (input.ref === undefined) {
    throw new Error('Ref error mapping requires a ref input');
  }
  return {ref: input.ref};
}
