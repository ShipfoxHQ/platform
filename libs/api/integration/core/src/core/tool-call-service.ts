import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {
  MaterializedAgentIntegrationConfigDto,
  MaterializedAgentIntegrationToolConfigDto,
} from '@shipfox/api-agent-dto';
import type {LeasedJobContext} from '@shipfox/api-auth-context';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import type {IntegrationAgentToolCallErrorCode} from '#metrics/index.js';
import type {IntegrationConnection} from './entities/connection.js';
import {IntegrationProviderError} from './errors.js';
import type {
  AgentToolCatalogEntry,
  AgentToolCatalogMethod,
  AgentToolJsonSchema,
  AgentToolSession,
  AgentToolsProvider,
} from './providers/agent-tools.js';
import type {IntegrationProviderRegistry} from './providers/registry.js';

export const NO_METHOD_LABEL = 'none';

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
  lease?: LeasedJobContext | undefined;
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
      result: await session.call({
        toolId: input.tool.id,
        arguments: input.arguments,
      }),
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

function toolCallLogContext(input: IntegrationToolCallInput): Record<string, unknown> {
  return {
    ...(input.lease === undefined
      ? {}
      : {
          jobId: input.lease.jobId,
          jobExecutionId: input.lease.jobExecutionId,
          workflowRunId: input.lease.workflowRunId,
          workflowRunAttemptId: input.lease.workflowRunAttemptId,
          workspaceId: input.lease.workspaceId,
          currentStepId: input.lease.currentStepId,
          currentStepAttempt: input.lease.currentStepAttempt,
        }),
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
