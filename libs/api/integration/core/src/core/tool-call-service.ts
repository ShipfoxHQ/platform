import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {
  MaterializedAgentIntegrationConfigDto,
  MaterializedAgentIntegrationToolConfigDto,
} from '@shipfox/api-agent-dto';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import type {IntegrationAgentToolCallErrorCode} from '#metrics/index.js';
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
  AgentToolSession,
  AgentToolsProvider,
} from './providers/agent-tools.js';
import type {IntegrationProviderRegistry} from './providers/registry.js';
import {
  callerLogContext,
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
  | {outcome: 'success'; result: CallToolResult}
  | {outcome: 'error'; error: IntegrationToolCallError};

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
  /** Cooperative cancellation for one call; an abort maps to `provider-timeout`. */
  signal?: AbortSignal | undefined;
  logger?: typeof logger;
  reportError?: typeof reportError;
}

export async function callIntegrationTool(
  input: IntegrationToolCallInput,
): Promise<IntegrationToolCallOutcome> {
  const log = input.logger ?? logger;
  const report = input.reportError ?? reportError;
  let session: AgentToolSession<CallToolResult> | undefined;

  try {
    const adapter = input.registry.getAdapter(
      input.integration.provider,
      'agent_tools',
    ) as AgentToolsProvider<
      typeof input.connection,
      unknown,
      typeof input.integration,
      CallToolResult
    >;
    session = await adapter.openSession({
      connection: input.connection,
      tools: [agentToolCatalogEntry(input)],
      scope: input.integration,
    });

    return {
      outcome: 'success',
      result: await raceWithSignal(
        session.call({
          toolId: input.tool.id,
          arguments: input.arguments,
        }),
        input.signal,
      ),
    };
  } catch (error) {
    const errorRecord = errorResult(error);
    if (errorRecord.code === 'provider-unavailable' || errorRecord.code === 'unknown') {
      log().error(
        {
          ...toolCallLogContext(input),
          err: error,
          errorCode: errorRecord.code,
          ...(errorRecord.status === undefined ? {} : {providerStatus: errorRecord.status}),
        },
        errorRecord.code === 'provider-unavailable'
          ? 'Integration agent tool provider was unavailable'
          : 'Integration agent tool call failed',
      );
      report(error, {boundary: 'integration.agent-tool'});
    }
    return {outcome: 'error', error: errorRecord};
  } finally {
    await closeSession(session, log, report);
  }
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
  try {
    return registry.get(provider).capabilities.includes('agent_tools');
  } catch {
    return false;
  }
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
  if (signal.aborted) return Promise.reject(abortReason(signal));
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
