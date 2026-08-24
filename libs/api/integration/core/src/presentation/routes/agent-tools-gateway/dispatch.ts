import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {LeasedJobContext} from '@shipfox/api-auth-context';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import {callIntegrationTool, type IntegrationToolCallError} from '#core/tool-call-service.js';
import type {IntegrationToolDispatcher, IntegrationToolDispatchInput} from './mcp-server.js';

export interface CreateIntegrationToolDispatcherParams {
  registry: IntegrationProviderRegistry;
  lease?: LeasedJobContext | undefined;
}

export interface IntegrationToolDispatcherDependencies {
  logger?: typeof logger;
  reportError?: typeof reportError;
}

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
  const outcome = await callIntegrationTool({
    registry: input.registry,
    connection: input.authorizedTool.connection,
    integration: input.authorizedTool.integration,
    tool: input.authorizedTool.tool,
    description: input.authorizedTool.description,
    inputSchema: input.authorizedTool.inputSchema,
    outputSchema: input.authorizedTool.outputSchema,
    arguments: input.arguments,
    method: input.method,
    lease: input.lease,
    logger: input.logger,
    reportError: input.reportError,
  });

  return outcome.outcome === 'success' ? outcome.result : toolError(outcome.error);
}

function toolError(error: IntegrationToolCallError): CallToolResult {
  return {
    isError: true,
    content: [{type: 'text', text: error.message}],
    structuredContent: {
      code: error.code,
      ...(error.retryAfterSeconds === undefined
        ? {}
        : {retryAfterSeconds: error.retryAfterSeconds}),
      ...(error.status === undefined ? {} : {status: error.status}),
    },
  };
}
