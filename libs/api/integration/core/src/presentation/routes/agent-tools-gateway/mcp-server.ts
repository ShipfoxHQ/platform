import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {
  INVALID_METHOD_LABEL,
  type IntegrationToolCallAuthorization,
  type IntegrationToolCallRecorder,
  integrationToolCallAuthorizationAuditFields,
  NO_METHOD_LABEL,
} from '#core/tool-call-audit.js';
import {
  type IntegrationAgentToolCallErrorCode,
  normalizeIntegrationAgentToolCallErrorCode,
} from '#metrics/index.js';
import type {
  AuthorizedIntegrationTool,
  AuthorizedIntegrationToolMap,
} from './resolve-authorized-tools.js';

export interface IntegrationToolDispatchInput {
  authorizedTool: AuthorizedIntegrationTool;
  arguments: Record<string, unknown>;
  method?: string | undefined;
}

export type IntegrationToolDispatcher = (
  input: IntegrationToolDispatchInput,
) => Promise<CallToolResult | IntegrationToolDispatchResult>;

export interface IntegrationToolDispatchResult {
  result: CallToolResult;
  authorization?: IntegrationToolCallAuthorization | undefined;
}

export type IntegrationToolProtocolErrorReason =
  | 'tool_not_found'
  | 'arguments_not_object'
  | 'missing_required_parameter'
  | 'invalid_parameter_type'
  | 'unauthorized_method';

export interface IntegrationToolProtocolError {
  readonly [key: string]: unknown;
  readonly code: 'invalid-request';
  readonly reason: IntegrationToolProtocolErrorReason;
  readonly tool?: string | undefined;
  readonly parameter?: string | undefined;
}

export interface BuildAgentToolsMcpServerParams {
  authorizedTools: AuthorizedIntegrationToolMap;
  dispatch: IntegrationToolDispatcher;
  recordCall?: IntegrationToolCallRecorder | undefined;
}

export function buildAgentToolsMcpServer(params: BuildAgentToolsMcpServerParams): Server {
  const server = new Server(
    {name: 'shipfox-integration-tools', version: '0.0.0'},
    {capabilities: {tools: {}}},
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...params.authorizedTools.values()].map((authorizedTool) => ({
      name: authorizedTool.mcpName,
      description: authorizedTool.description,
      inputSchema: authorizedTool.inputSchema as {
        type: 'object';
        properties?: Record<string, object> | undefined;
        required?: string[] | undefined;
      },
      ...(authorizedTool.outputSchema
        ? {
            outputSchema: authorizedTool.outputSchema as {
              type: 'object';
              properties?: Record<string, object> | undefined;
              required?: string[] | undefined;
            },
          }
        : {}),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const authorizedTool = params.authorizedTools.get(request.params.name);
    if (!authorizedTool) {
      recordToolCall(params.recordCall, {
        arguments: request.params.arguments ?? {},
        method: NO_METHOD_LABEL,
        outcome: 'invalid-request',
        errorCode: 'invalid-request',
      });
      return toolError(`Unknown integration tool: ${request.params.name}`, {
        code: 'invalid-request',
        reason: 'tool_not_found',
        tool: request.params.name,
      });
    }

    const args = request.params.arguments ?? {};
    if (!isRecord(args)) {
      recordToolCall(params.recordCall, {
        authorizedTool,
        arguments: args,
        method: NO_METHOD_LABEL,
        outcome: 'invalid-request',
        errorCode: 'invalid-request',
      });
      return toolError('Tool arguments must be an object', {
        code: 'invalid-request',
        reason: 'arguments_not_object',
        tool: authorizedTool.tool.id,
      });
    }

    const methodValidation = validateMethod(authorizedTool, args);
    if (methodValidation.kind === 'error') {
      recordToolCall(params.recordCall, {
        authorizedTool,
        arguments: args,
        method: INVALID_METHOD_LABEL,
        outcome: 'invalid-request',
        errorCode: 'invalid-request',
      });
      return toolError(methodValidation.message, methodValidation.details);
    }
    const method = methodValidation.method ?? NO_METHOD_LABEL;

    try {
      const dispatched = await params.dispatch({
        authorizedTool,
        arguments: args,
        method: methodValidation.method,
      });
      const {result, authorization} = unpackDispatchResult(dispatched);
      recordToolCall(params.recordCall, {
        authorizedTool,
        arguments: args,
        method,
        outcome: result.isError === true ? 'tool-error' : 'success',
        ...toolCallErrorDetails(result),
        ...integrationToolCallAuthorizationAuditFields(authorization),
      });
      return result;
    } catch (error) {
      recordToolCall(params.recordCall, {
        authorizedTool,
        arguments: args,
        method,
        outcome: 'exception',
        errorCode: 'unknown',
      });
      throw error;
    }
  });

  return server;
}

function unpackDispatchResult(dispatched: CallToolResult | IntegrationToolDispatchResult): {
  result: CallToolResult;
  authorization?: IntegrationToolCallAuthorization | undefined;
} {
  if (isRecord(dispatched) && isRecord(dispatched.result) && 'content' in dispatched.result) {
    return {
      result: dispatched.result as CallToolResult,
      authorization: isRecord(dispatched.authorization)
        ? (dispatched.authorization as unknown as IntegrationToolCallAuthorization)
        : undefined,
    };
  }
  return {result: dispatched as CallToolResult};
}

function toolCallErrorDetails(result: CallToolResult): {
  errorCode: IntegrationAgentToolCallErrorCode | 'none';
  providerStatus?: number | undefined;
} {
  if (result.isError !== true) return {errorCode: 'none'};

  const structuredContent = isRecord(result.structuredContent)
    ? result.structuredContent
    : undefined;
  const providerStatus = statusCode(structuredContent?.status);

  return {
    errorCode: normalizeIntegrationAgentToolCallErrorCode(structuredContent?.code),
    ...(providerStatus === undefined ? {} : {providerStatus}),
  };
}

function recordToolCall(
  recordCall: IntegrationToolCallRecorder | undefined,
  record: Parameters<IntegrationToolCallRecorder>[0],
): void {
  try {
    recordCall?.(record);
  } catch (error) {
    // Audit and metrics must not affect MCP responses.
    logger().error({err: error}, 'Failed to record integration agent tool audit event');
    reportError(error, {boundary: 'integration.agent-tool', operation: 'audit'});
  }
}

function validateMethod(
  authorizedTool: AuthorizedIntegrationTool,
  args: Record<string, unknown>,
):
  | {kind: 'ok'; method?: string | undefined}
  | {kind: 'error'; message: string; details: IntegrationToolProtocolError} {
  if (!authorizedTool.tool.methods) return {kind: 'ok'};

  const method = args.method;
  if (typeof method !== 'string') {
    return {
      kind: 'error',
      message: 'Method-family tools require a string method argument',
      details: {
        code: 'invalid-request',
        reason: Object.hasOwn(args, 'method')
          ? 'invalid_parameter_type'
          : 'missing_required_parameter',
        tool: authorizedTool.tool.id,
        parameter: 'method',
      },
    };
  }

  const allowedMethods = new Set(authorizedTool.tool.methods.map((candidate) => candidate.id));
  if (!allowedMethods.has(method)) {
    return {
      kind: 'error',
      message: `Unauthorized integration tool method: ${method}`,
      details: {
        code: 'invalid-request',
        reason: 'unauthorized_method',
        tool: authorizedTool.tool.id,
        parameter: 'method',
      },
    };
  }

  return {kind: 'ok', method};
}

function toolError(message: string, details: IntegrationToolProtocolError): CallToolResult {
  return {
    isError: true,
    content: [{type: 'text', text: message}],
    structuredContent: details,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function statusCode(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}
