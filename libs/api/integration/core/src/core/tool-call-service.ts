import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {
  MaterializedAgentIntegrationConfigDto,
  MaterializedAgentIntegrationToolConfigDto,
} from '@shipfox/api-agent-dto';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {
  type IntegrationAgentToolCallErrorCode,
  normalizeIntegrationAgentToolCallErrorCode,
} from '#metrics/index.js';
import type {IntegrationConnection} from './entities/connection.js';
import {
  IntegrationCapabilityUnavailableError,
  IntegrationConnectionInactiveError,
  IntegrationConnectionNotFoundError,
  IntegrationConnectionProviderChangedError,
  IntegrationConnectionWorkspaceMismatchError,
  IntegrationProviderError,
} from './errors.js';
import type {
  AgentToolCatalogEntry,
  AgentToolCatalogMethod,
  AgentToolJsonSchema,
  AgentToolRepositoryScope,
  AgentToolSession,
  AgentToolsProvider,
} from './providers/agent-tools.js';
import type {IntegrationProviderRegistry} from './providers/registry.js';
import {
  createRepositoryAuthorizationRequestContext,
  type RepositoryAuthorizationDenial,
  type RepositoryAuthorizationMode,
  type RepositoryAuthorizer,
  repositoryAuthorizationClientErrorCode,
} from './repository-authorizer.js';
import {
  callerLogContext,
  type IntegrationToolCallAuthorization,
  type IntegrationToolCallCaller,
  NO_METHOD_LABEL,
} from './tool-call-audit.js';

export type {IntegrationToolCallCaller} from './tool-call-audit.js';

export interface IntegrationToolCallError {
  code: IntegrationAgentToolCallErrorCode;
  message: string;
  retryAfterSeconds?: number | undefined;
  status?: number | undefined;
}

export type IntegrationToolCallOutcome =
  | {
      outcome: 'success';
      result: CallToolResult;
      authorization?: IntegrationToolCallAuthorization | undefined;
    }
  | {
      outcome: 'error';
      error: IntegrationToolCallError;
      authorization?: IntegrationToolCallAuthorization | undefined;
    };

export interface IntegrationToolCallInput {
  registry: IntegrationProviderRegistry;
  connection: IntegrationConnection;
  integration: MaterializedAgentIntegrationConfigDto;
  tool: MaterializedAgentIntegrationToolConfigDto;
  description: string;
  inputSchema: AgentToolJsonSchema;
  outputSchema?: AgentToolJsonSchema | undefined;
  arguments: Record<string, unknown>;
  method?: string | undefined;
  caller: IntegrationToolCallCaller;
  /** Live catalog metadata used by the shared repository-scope boundary. */
  catalogEntry?: AgentToolCatalogEntry | undefined;
  /** The persisted connection mode will be threaded here when that schema lands. */
  repositoryAccessMode?: RepositoryAuthorizationMode | undefined;
  repositoryAuthorizer?: RepositoryAuthorizer | undefined;
  /** Cooperative cancellation for one call; an abort maps to `provider-timeout`. */
  signal?: AbortSignal | undefined;
  logger?: typeof logger;
  reportError?: typeof reportError;
}

interface ToolSessionState {
  session: AgentToolSession<CallToolResult> | undefined;
  openingSession: Promise<AgentToolSession<CallToolResult>> | undefined;
}

async function executeIntegrationTool(
  input: IntegrationToolCallInput,
  state: ToolSessionState,
): Promise<IntegrationToolCallOutcome> {
  if (input.signal?.aborted) return {outcome: 'error', error: abortOutcome(input.signal)};
  const adapter = input.registry.getAdapter(
    input.integration.provider,
    'agent_tools',
  ) as AgentToolsProvider<
    typeof input.connection,
    unknown,
    typeof input.integration,
    CallToolResult
  >;
  state.openingSession = adapter.openSession({
    connection: input.connection,
    tools: [agentToolCatalogEntry(input)],
    scope: input.integration,
  });
  state.session = await raceWithSignal(state.openingSession, input.signal);
  if (input.signal?.aborted) return {outcome: 'error', error: abortOutcome(input.signal)};
  const result = await raceWithSignal(
    state.session.call({toolId: input.tool.id, arguments: input.arguments}),
    input.signal,
  );
  if (result.isError === true) return {outcome: 'error', error: providerToolError(result)};
  return {outcome: 'success', result};
}

function logIntegrationToolError(
  input: IntegrationToolCallInput,
  error: unknown,
  errorRecord: IntegrationToolCallError,
  log: typeof logger,
  report: typeof reportError,
): void {
  if (!['provider-unavailable', 'provider-timeout', 'unknown'].includes(errorRecord.code)) return;
  let message = 'Integration agent tool call failed';
  if (errorRecord.code === 'provider-unavailable') {
    message = 'Integration agent tool provider was unavailable';
  } else if (errorRecord.code === 'provider-timeout') {
    message = 'Integration agent tool provider timed out';
  }
  log().error(
    {
      ...toolCallLogContext(input),
      err: error,
      errorCode: errorRecord.code,
      ...(errorRecord.status === undefined ? {} : {providerStatus: errorRecord.status}),
    },
    message,
  );
  report(error, {boundary: 'integration.agent-tool'});
}

function handleIntegrationToolError(
  input: IntegrationToolCallInput,
  error: unknown,
  state: ToolSessionState,
  log: typeof logger,
  report: typeof reportError,
  authorization?: IntegrationToolCallAuthorization | undefined,
): IntegrationToolCallOutcome {
  if (input.signal?.aborted) {
    if (state.openingSession !== undefined && state.session === undefined) {
      void state.openingSession.then(
        (opened) => closeSession(opened, log, report),
        () => undefined,
      );
    }
    return withAuthorization({outcome: 'error', error: abortOutcome(input.signal)}, authorization);
  }
  const errorRecord = errorResult(error);
  logIntegrationToolError(input, error, errorRecord, log, report);
  return withAuthorization({outcome: 'error', error: errorRecord}, authorization);
}

export async function callIntegrationTool(
  input: IntegrationToolCallInput,
): Promise<IntegrationToolCallOutcome> {
  const log = input.logger ?? logger;
  const report = input.reportError ?? reportError;
  const state: ToolSessionState = {session: undefined, openingSession: undefined};
  let authorization: IntegrationToolCallAuthorization | undefined;

  try {
    if (input.repositoryAuthorizer !== undefined) {
      const catalogEntry = await liveCatalogEntry(input);
      authorization = await resolveIntegrationToolAuthorization(input, catalogEntry);
      if (authorization.decision === 'denied' && authorization.denialReason !== 'none') {
        return withAuthorization(
          {
            outcome: 'error',
            error: {
              code: repositoryAuthorizationClientErrorCode(authorization.denialReason),
              message: repositoryAuthorizationErrorMessage(authorization.denialReason),
            },
          },
          authorization,
        );
      }
    }

    return withAuthorization(await executeIntegrationTool(input, state), authorization);
  } catch (error) {
    return handleIntegrationToolError(input, error, state, log, report, authorization);
  } finally {
    await closeSession(state.session, log, report);
  }
}

/**
 * Evaluates the live tool classifier and the local authorizer immediately
 * before a provider session is opened. This is deliberately shared by the MCP
 * and deterministic callers through `callIntegrationTool`.
 */
export async function resolveIntegrationToolAuthorization(
  input: IntegrationToolCallInput,
  catalogEntry: AgentToolCatalogEntry | undefined,
): Promise<IntegrationToolCallAuthorization> {
  const mode = input.repositoryAccessMode ?? 'selected';
  const provider = input.registry.get(input.integration.provider);
  const scope = classifyToolCall(
    catalogEntry,
    input.method,
    input.arguments,
    provider.repositoryAuthorization,
  );
  const authorization = createBaseAuthorization(
    input,
    mode,
    provider.repositoryAuthorization,
    scope,
  );

  if (!shouldAuthorizeDeclaredTargets(input, provider.repositoryAuthorization, scope)) {
    return authorization;
  }
  return await authorizeDeclaredTargets(input, mode, scope, authorization);
}

function createBaseAuthorization(
  input: IntegrationToolCallInput,
  mode: RepositoryAuthorizationMode,
  providerAuthorization: 'enforced' | 'unclassified' | undefined,
  scope: ClassifiedToolCallScope,
): IntegrationToolCallAuthorization {
  const runProject = runProjectId(input.caller);
  return {
    repositories: scope.kind === 'declared-targets' ? scope.repositories : [],
    classification: providerAuthorization === 'enforced' ? scope.kind : 'unclassified',
    repositoryAccess: mode,
    decision: input.repositoryAuthorizer?.enabled ? 'not-applicable' : 'not-enforced',
    denialReason: 'none',
    targetProjectIds: [],
    ...(runProject === undefined ? {} : {runProjectId: runProject}),
    ...(scope.indirectTargetNote === undefined
      ? {}
      : {indirectTargetNote: scope.indirectTargetNote}),
  };
}

function shouldAuthorizeDeclaredTargets(
  input: IntegrationToolCallInput,
  providerAuthorization: 'enforced' | 'unclassified' | undefined,
  scope: ClassifiedToolCallScope,
): scope is ClassifiedToolCallScope & {kind: 'declared-targets'} {
  return (
    input.repositoryAuthorizer?.enabled === true &&
    providerAuthorization === 'enforced' &&
    scope.kind === 'declared-targets'
  );
}

async function authorizeDeclaredTargets(
  input: IntegrationToolCallInput,
  mode: RepositoryAuthorizationMode,
  scope: ClassifiedToolCallScope & {kind: 'declared-targets'},
  authorization: IntegrationToolCallAuthorization,
): Promise<IntegrationToolCallAuthorization> {
  const authorizer = input.repositoryAuthorizer;
  if (authorizer === undefined) return authorization;

  const request = createRepositoryAuthorizationRequestContext();
  const targetProjectIds: string[] = [];
  let denialReason: RepositoryAuthorizationDenial | undefined;
  for (const repository of scope.repositories) {
    const result = await authorizer.resolveRepositoryAuthorization({
      workspaceId: input.connection.workspaceId,
      connectionId: input.connection.id,
      mode,
      repository: {kind: 'name', owner: repository.owner, name: repository.name},
      capability: 'tools',
      request,
    });
    if (result === undefined) {
      denialReason ??= 'authorization_store_unavailable';
      continue;
    }
    if (!result.authorized) {
      denialReason ??= result.reason;
      continue;
    }
    if (
      result.targetProjectId !== undefined &&
      !targetProjectIds.includes(result.targetProjectId)
    ) {
      targetProjectIds.push(result.targetProjectId);
    }
  }

  return denialReason === undefined
    ? {...authorization, decision: 'allowed', targetProjectIds}
    : {...authorization, decision: 'denied', denialReason, targetProjectIds};
}

type ClassifiedToolCallScope = AgentToolRepositoryScope & {
  indirectTargetNote?: string | undefined;
};

async function liveCatalogEntry(
  input: IntegrationToolCallInput,
): Promise<AgentToolCatalogEntry | undefined> {
  if (input.catalogEntry?.id === input.tool.id) return input.catalogEntry;
  const catalog = await input.registry
    .getAdapter(input.integration.provider, 'agent_tools')
    .catalog();
  return catalog.find((entry) => entry.id === input.tool.id);
}

function classifyToolCall(
  entry: AgentToolCatalogEntry | undefined,
  method: string | undefined,
  arguments_: Record<string, unknown>,
  providerAuthorization: 'enforced' | 'unclassified' | undefined,
): ClassifiedToolCallScope {
  const catalogMethod = entry?.methods?.find((candidate) => candidate.id === method);
  const classifier = catalogMethod?.repositoryScope ?? entry?.repositoryScope;
  if (classifier === undefined) {
    if (providerAuthorization === 'enforced') {
      throw new IntegrationProviderError(
        'provider-rejected',
        'Enforced integration tool is missing a repository scope classifier',
      );
    }
    return {kind: 'connection'};
  }

  return {
    ...classifier(arguments_),
    ...((catalogMethod?.indirectTargetNote ?? entry?.indirectTargetNote) === undefined
      ? {}
      : {
          indirectTargetNote: catalogMethod?.indirectTargetNote ?? entry?.indirectTargetNote,
        }),
  };
}

function runProjectId(caller: IntegrationToolCallCaller): string | undefined {
  return caller.caller === 'agent' ? caller.lease?.projectId : caller.projectId;
}

function repositoryAuthorizationErrorMessage(reason: RepositoryAuthorizationDenial): string {
  switch (reason) {
    case 'repository_not_granted':
      return 'Repository is not authorized for this integration connection';
    case 'repository_ambiguous':
      return 'Repository authorization is ambiguous for this integration connection';
    case 'authorization_store_unavailable':
      return 'Repository authorization is temporarily unavailable';
  }
}

function withAuthorization(
  outcome: IntegrationToolCallOutcome,
  authorization: IntegrationToolCallAuthorization | undefined,
): IntegrationToolCallOutcome {
  return authorization === undefined ? outcome : {...outcome, authorization};
}

export interface LoadAuthorizedToolConnectionParams {
  workspaceId: string;
  connectionId: string;
  provider: string;
  registry: IntegrationProviderRegistry;
  getIntegrationConnectionById: (
    connectionId: string,
  ) => Promise<IntegrationConnection | undefined>;
}

/**
 * Applies `loadAuthorizedConnection`'s checks for one frozen tool call:
 * the connection exists, belongs to the workspace, is active, still serves the
 * frozen provider, and the provider still exposes the agent-tools capability.
 * Each violation throws a typed domain error the caller maps to its own
 * boundary (HTTP `ClientError` for the gateway, inter-module known errors for
 * `callTool`).
 */
export async function loadAuthorizedToolConnection(
  params: LoadAuthorizedToolConnectionParams,
): Promise<IntegrationConnection> {
  const connection = await params.getIntegrationConnectionById(params.connectionId);
  if (!connection) throw new IntegrationConnectionNotFoundError(params.connectionId);
  if (connection.workspaceId !== params.workspaceId) {
    throw new IntegrationConnectionWorkspaceMismatchError(params.connectionId);
  }
  if (connection.lifecycleStatus !== 'active') {
    throw new IntegrationConnectionInactiveError(params.connectionId);
  }
  if (connection.provider !== params.provider) {
    throw new IntegrationConnectionProviderChangedError(params.connectionId);
  }
  if (!providerSupportsAgentTools(params.registry, params.provider)) {
    throw new IntegrationCapabilityUnavailableError('agent_tools', params.provider);
  }

  return connection;
}

function providerSupportsAgentTools(
  registry: IntegrationProviderRegistry,
  provider: string,
): boolean {
  // `registry.get` throws `IntegrationProviderUnavailableError` when the
  // provider is no longer registered; that must propagate so the caller maps
  // it to `provider-unavailable` instead of `capability-unavailable`.
  return registry.get(provider).capabilities.includes('agent_tools');
}

function toolCallLogContext(input: IntegrationToolCallInput): Record<string, unknown> {
  return {
    ...callerLogContext(input.caller),
    connectionId: input.connection.id,
    provider: input.integration.provider,
    toolId: input.tool.id,
    method: input.method ?? NO_METHOD_LABEL,
  };
}

function agentToolCatalogEntry(input: IntegrationToolCallInput): AgentToolCatalogEntry {
  const {tool, description, inputSchema, outputSchema} = input;
  return {
    id: tool.id,
    description,
    sensitivity: tool.sensitivity,
    sensitive: tool.sensitive,
    requiredScope: tool.requiredScope,
    inputSchema,
    ...(outputSchema === undefined ? {} : {outputSchema}),
    ...(tool.methods === undefined
      ? {}
      : {
          methods: tool.methods.map(
            (method): AgentToolCatalogMethod => ({
              id: method.id,
              description: method.description ?? method.token,
              sensitivity: method.sensitivity,
              sensitive: method.sensitive,
              requiredScope: method.requiredScope,
            }),
          ),
        }),
  };
}

async function closeSession(
  session: {close?(): Promise<void>} | undefined,
  loggerFactory: typeof logger,
  reportErrorFn: typeof reportError,
): Promise<void> {
  try {
    await session?.close?.();
  } catch (error) {
    // Cleanup must not mask the tool result returned to the runner.
    loggerFactory().error({err: error}, 'Failed to close integration agent tool session');
    reportErrorFn(error, {boundary: 'integration.agent-tool', operation: 'close-session'});
  }
}

/**
 * Races the provider call against a caller-provided signal. The call's own
 * rejection and an abort are both surfaced as the call's failure, so the
 * existing `errorResult` table classifies an abort as `provider-timeout`.
 */
function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) {
    // The promise was already started by the caller; keep its rejection
    // observed so an unhandled rejection cannot crash the process.
    void promise.catch(() => undefined);
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, {once: true});
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

/**
 * Classifies a caller-initiated abort. A deadline that expired
 * (`AbortSignal.timeout`) reads as `provider-timeout`; any other cancellation
 * reads as `cancelled` so cancellation volume never leaks into the timeout
 * failure class or into error monitoring.
 */
function abortOutcome(signal: AbortSignal): IntegrationToolCallError {
  const reason = signal.reason;
  if (
    reason instanceof Error &&
    (timeoutErrorNamePattern.test(reason.name) ||
      (reason.name === 'McpError' && mcpRequestTimeoutMessagePattern.test(reason.message)))
  ) {
    return {code: 'provider-timeout', message: 'Integration provider timed out'};
  }
  return {code: 'cancelled', message: 'Integration tool call cancelled'};
}

/** Maps a provider tool-level `isError` result into the bounded error outcome. */
function providerToolError(result: CallToolResult): IntegrationToolCallError {
  const structuredContent = isRecord(result.structuredContent)
    ? result.structuredContent
    : undefined;
  const status = statusCode(structuredContent?.status);
  const retryAfterSeconds = retryAfterSecondsValue(structuredContent?.retryAfterSeconds);
  return {
    code: normalizeIntegrationAgentToolCallErrorCode(structuredContent?.code),
    message: textContent(result.content) ?? 'Integration tool call failed',
    ...(status === undefined ? {} : {status}),
    ...(retryAfterSeconds === undefined ? {} : {retryAfterSeconds}),
  };
}

function textContent(content: CallToolResult['content']): string | undefined {
  const text = content.find((block) => isRecord(block) && block.type === 'text' && 'text' in block);
  return isRecord(text) && typeof text.text === 'string' ? text.text : undefined;
}

function statusCode(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function retryAfterSecondsValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const timeoutErrorNamePattern = /timed?\s*out|timeout/i;
const mcpRequestTimeoutMessagePattern = /^MCP error -32001:\s*Request timed out\b/i;
const credentialErrorNamePattern = /Token|Credential|Secret|AccessToken/;

function errorResult(error: unknown): IntegrationToolCallError {
  if (error instanceof IntegrationProviderError) {
    return {
      code: error.reason,
      message: error.message,
      ...(error.retryAfterSeconds === undefined
        ? {}
        : {retryAfterSeconds: error.retryAfterSeconds}),
      ...(error.status === undefined ? {} : {status: error.status}),
    };
  }

  if (isTimeoutError(error)) {
    return {
      code: 'provider-timeout',
      message: 'Integration provider timed out',
    };
  }

  if (isCredentialError(error)) {
    return {
      code: 'credentials-unavailable',
      message: 'Integration provider credentials are unavailable',
    };
  }

  return {
    code: 'unknown',
    message: 'Integration tool call failed',
  };
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'AbortError' ||
    timeoutErrorNamePattern.test(error.name) ||
    (error.name === 'McpError' && mcpRequestTimeoutMessagePattern.test(error.message))
  );
}

function isCredentialError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return credentialErrorNamePattern.test(error.name);
}
