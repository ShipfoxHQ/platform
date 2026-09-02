import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {agentAccessEnvelopeSchema} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {AGENT_ACCESS_MCP_INSTRUCTIONS, AGENT_ACCESS_MCP_SERVER_NAME} from '#constants.js';
import {agentAccessError, serializeAgentAccessEnvelope} from '#core/envelope.js';
import {type AgentAccessRateLimiter, createAgentAccessRateLimiter} from '#core/rate-limiter.js';
import {
  type AgentAccessTool,
  type AgentAccessToolMap,
  createAgentAccessFixtureTool,
  createAgentAccessToolMap,
} from '#core/tools.js';
import type {AgentAccessToolCallOutcome} from '#metrics/index.js';
import {AGENT_ACCESS_PACKAGE_VERSION} from '#version.js';
import {type AgentAccessToolCallRecorder, createAgentAccessToolCallRecorder} from './audit.js';

export interface BuildAgentAccessMcpServerParams {
  context: AgentAccessContext;
  tools?: readonly AgentAccessTool[] | undefined;
  rateLimiter?: AgentAccessRateLimiter | undefined;
  recordCall?: AgentAccessToolCallRecorder | undefined;
}

const defaultTools = (): readonly AgentAccessTool[] => [createAgentAccessFixtureTool()];

export function buildAgentAccessMcpServer(params: BuildAgentAccessMcpServerParams): Server {
  const tools = createAgentAccessToolMap(params.tools ?? defaultTools());
  const rateLimiter = params.rateLimiter ?? createAgentAccessRateLimiter();
  const recordCall = params.recordCall ?? createAgentAccessToolCallRecorder();
  const server = new Server(
    {name: AGENT_ACCESS_MCP_SERVER_NAME, version: AGENT_ACCESS_PACKAGE_VERSION},
    {
      capabilities: {tools: {}},
      instructions: AGENT_ACCESS_MCP_INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as {
        type: 'object';
        properties?: Record<string, object> | undefined;
        required?: string[] | undefined;
      },
      outputSchema: tool.outputSchema as {
        type: 'object';
        properties?: Record<string, object> | undefined;
        required?: string[] | undefined;
      },
      annotations: {readOnlyHint: true},
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) =>
    handleAgentAccessToolCall({
      name: request.params.name,
      arguments: request.params.arguments,
      context: params.context,
      tools,
      rateLimiter,
      recordCall,
    }),
  );

  return server;
}

interface HandleAgentAccessToolCallParams {
  name: string;
  arguments?: Record<string, unknown> | undefined;
  context: AgentAccessContext;
  tools: AgentAccessToolMap;
  rateLimiter: AgentAccessRateLimiter;
  recordCall: AgentAccessToolCallRecorder;
}

async function handleAgentAccessToolCall(
  params: HandleAgentAccessToolCallParams,
): Promise<CallToolResult> {
  const tool = params.tools.get(params.name);
  const rateLimit = params.rateLimiter.consume(params.context.credential);
  if (!rateLimit.allowed) {
    recordToolCall(params.recordCall, {
      tool: tool?.name ?? 'unknown',
      outcome: 'rate-limited',
      errorCode: 'rate-limited',
      context: params.context,
    });
    return toolResult(
      agentAccessError(
        'rate-limited',
        rateLimit.retry_after_seconds === undefined
          ? {}
          : {retryAfterSeconds: rateLimit.retry_after_seconds},
      ),
      true,
    );
  }
  if (tool === undefined) return unknownToolResult(params);

  const input = params.arguments ?? {};
  if (!isRecord(input)) return invalidArgumentsResult(params, tool.name);
  return await executeAgentAccessTool({
    tool,
    input,
    context: params.context,
    recordCall: params.recordCall,
  });
}

async function executeAgentAccessTool(params: {
  tool: AgentAccessTool;
  input: Record<string, unknown>;
  context: AgentAccessContext;
  recordCall: AgentAccessToolCallRecorder;
}): Promise<CallToolResult> {
  try {
    const response = await params.tool.execute({context: params.context, arguments: params.input});
    const envelope = agentAccessEnvelopeSchema.safeParse(response);
    if (!envelope.success) {
      recordToolCall(params.recordCall, {
        tool: params.tool.name,
        outcome: 'exception',
        errorCode: 'invalid-tool-response',
        context: params.context,
      });
      return toolResult(agentAccessError('invalid-tool-response'), true);
    }

    const outcome: AgentAccessToolCallOutcome = envelope.data.ok ? 'success' : 'tool-error';
    recordToolCall(params.recordCall, {
      tool: params.tool.name,
      outcome,
      errorCode: envelope.data.ok ? 'none' : (envelope.data.error?.code ?? 'unknown'),
      context: params.context,
    });
    return toolResult(envelope.data, !envelope.data.ok);
  } catch (error) {
    recordToolCall(params.recordCall, {
      tool: params.tool.name,
      outcome: 'exception',
      errorCode: 'unknown',
      context: params.context,
    });
    logger().error({err: error, tool: params.tool.name}, 'Agent-access tool execution failed');
    reportError(error, {boundary: 'agent-access.mcp', operation: 'tool-call'});
    return toolResult(agentAccessError('tool-failed'), true);
  }
}

function unknownToolResult(params: HandleAgentAccessToolCallParams): CallToolResult {
  recordToolCall(params.recordCall, {
    tool: 'unknown',
    outcome: 'invalid-request',
    errorCode: 'unknown-tool',
    context: params.context,
  });
  return toolResult(agentAccessError('unknown-tool', {message: 'Tool is not available'}), true);
}

function invalidArgumentsResult(
  params: HandleAgentAccessToolCallParams,
  toolName: string,
): CallToolResult {
  recordToolCall(params.recordCall, {
    tool: toolName,
    outcome: 'invalid-request',
    errorCode: 'invalid-request',
    context: params.context,
  });
  return toolResult(
    agentAccessError('invalid-request', {message: 'Tool arguments must be an object'}),
    true,
  );
}

function toolResult(
  envelope: ReturnType<typeof agentAccessError>,
  isError: boolean,
): CallToolResult {
  return {
    ...(isError ? {isError: true} : {}),
    content: [{type: 'text', text: serializeAgentAccessEnvelope(envelope)}],
    structuredContent: envelope as Record<string, unknown>,
  };
}

function recordToolCall(
  recordCall: AgentAccessToolCallRecorder,
  record: Parameters<AgentAccessToolCallRecorder>[0],
): void {
  try {
    recordCall(record);
  } catch (error) {
    logger().error({err: error}, 'Failed to record agent-access tool audit event');
    reportError(error, {boundary: 'agent-access.mcp', operation: 'audit'});
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
