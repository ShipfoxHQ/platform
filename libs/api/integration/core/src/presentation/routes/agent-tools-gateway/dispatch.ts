import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {LeasedJobContext} from '@shipfox/api-auth-context';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {IntegrationProviderError} from '#core/errors.js';
import type {
  AgentToolCatalogEntry,
  AgentToolCatalogMethod,
  AgentToolSession,
  AgentToolsProvider,
} from '#core/providers/agent-tools.js';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import {NO_METHOD_LABEL} from './audit.js';
import type {IntegrationToolDispatcher, IntegrationToolDispatchInput} from './mcp-server.js';

export interface CreateIntegrationToolDispatcherParams {
  registry: IntegrationProviderRegistry;
  lease?: LeasedJobContext | undefined;
}

export interface IntegrationToolDispatcherDependencies {
  logger?: typeof logger;
  reportError?: typeof reportError;
}

const timeoutErrorPattern = /timed?\s*out|timeout/i;
const credentialErrorNamePattern = /Token|Credential|Secret|AccessToken/;

export function createIntegrationToolDispatcher(
  params: CreateIntegrationToolDispatcherParams,
  dependencies: IntegrationToolDispatcherDependencies = {},
): IntegrationToolDispatcher {
  return (input) =>
    dispatchIntegrationToolCall({
      ...input,
      registry: params.registry,
      lease: params.lease,
      logger: dependencies.logger ?? logger,
      reportError: dependencies.reportError ?? reportError,
    });
}

async function dispatchIntegrationToolCall(
  input: IntegrationToolDispatchInput & {
    registry: IntegrationProviderRegistry;
    lease?: LeasedJobContext | undefined;
    logger: typeof logger;
    reportError: typeof reportError;
  },
): Promise<CallToolResult> {
  let session: AgentToolSession<CallToolResult> | undefined;

  try {
    const adapter = input.registry.getAdapter(
      input.authorizedTool.integration.provider,
      'agent_tools',
    ) as AgentToolsProvider<
      typeof input.authorizedTool.connection,
      unknown,
      typeof input.authorizedTool.integration,
      CallToolResult
    >;
    session = await adapter.openSession({
      connection: input.authorizedTool.connection,
      tools: [agentToolCatalogEntry(input)],
      scope: input.authorizedTool.integration,
    });

    return await session.call({
      toolId: input.authorizedTool.tool.id,
      arguments: input.arguments,
    });
  } catch (error) {
    const result = errorResult(error);
    if (result.code === 'provider-unavailable') {
      input.logger().error(
        {
          ...toolCallLogContext(input),
          err: error,
          errorCode: result.code,
          ...(result.status === undefined ? {} : {providerStatus: result.status}),
        },
        'Integration agent tool provider was unavailable',
      );
      input.reportError(error, {boundary: 'integration.agent-tool'});
    }
    return toolError(result);
  } finally {
    await closeSession(session, input.logger, input.reportError);
  }
}

function toolCallLogContext(
  input: IntegrationToolDispatchInput & {lease?: LeasedJobContext | undefined},
): Record<string, unknown> {
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
    connectionId: input.authorizedTool.connection.id,
    provider: input.authorizedTool.integration.provider,
    toolId: input.authorizedTool.tool.id,
    method: input.method ?? NO_METHOD_LABEL,
  };
}

function agentToolCatalogEntry(input: IntegrationToolDispatchInput): AgentToolCatalogEntry {
  const {tool, description, inputSchema, outputSchema} = input.authorizedTool;
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

interface IntegrationToolError {
  code: string;
  message: string;
  retryAfterSeconds?: number | undefined;
  status?: number | undefined;
}

function errorResult(error: unknown): IntegrationToolError {
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
    code: 'provider-unavailable',
    message: 'Integration provider call failed',
  };
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'AbortError' ||
    timeoutErrorPattern.test(error.name) ||
    timeoutErrorPattern.test(error.message)
  );
}

function isCredentialError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return credentialErrorNamePattern.test(error.name);
}

function toolError(params: IntegrationToolError): CallToolResult {
  return {
    isError: true,
    content: [{type: 'text', text: params.message}],
    structuredContent: {
      code: params.code,
      ...(params.retryAfterSeconds === undefined
        ? {}
        : {retryAfterSeconds: params.retryAfterSeconds}),
      ...(params.status === undefined ? {} : {status: params.status}),
    },
  };
}
