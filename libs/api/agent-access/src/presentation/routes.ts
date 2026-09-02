import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {AUTH_AGENT_ACCESS, requireAgentAccessContext} from '@shipfox/api-auth-context';
import {reportError} from '@shipfox/node-error-monitoring';
import {
  ClientError,
  createAllowedOriginMatcher,
  errorHandler as defaultErrorHandler,
  defineRoute,
  type FastifyReply,
  type FastifyRequest,
  type RouteGroup,
  type RoutePreHandler,
} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {AGENT_ACCESS_MCP_PATH, AGENT_ACCESS_PROTECTED_RESOURCE_METADATA_PATH} from '#constants.js';
import {type AgentAccessRateLimiter, createAgentAccessRateLimiter} from '#core/rate-limiter.js';
import {type AgentAccessTool, createAgentAccessFixtureTool} from '#core/tools.js';
import {recordAgentAccessAuthFailure} from '#metrics/index.js';
import {type AgentAccessToolCallRecorder, createAgentAccessToolCallRecorder} from './audit.js';
import {buildAgentAccessMcpServer} from './mcp-server.js';

const TRAILING_SLASHES_RE = /\/+$/u;

export interface CreateAgentAccessRoutesOptions {
  apiPublicUrl?: string | undefined;
  protectedResourceMetadataUrl?: string | undefined;
  tools?: readonly AgentAccessTool[] | undefined;
  rateLimiter?: AgentAccessRateLimiter | undefined;
  recordCall?: AgentAccessToolCallRecorder | undefined;
  isOriginAllowed?: ((origin: string | undefined) => boolean) | undefined;
}

export function createAgentAccessRoutes(options: CreateAgentAccessRoutesOptions = {}): RouteGroup {
  const tools = options.tools ?? [createAgentAccessFixtureTool()];
  const rateLimiter = options.rateLimiter ?? createAgentAccessRateLimiter();
  const recordCall = options.recordCall ?? createAgentAccessToolCallRecorder();
  const originMatcher = options.isOriginAllowed ?? createAllowedOriginMatcher();
  const errorHandler = createAgentAccessErrorHandler(resourceMetadataUrl(options));

  return {
    prefix: '',
    routes: [
      defineRoute({
        method: 'GET',
        path: AGENT_ACCESS_MCP_PATH,
        description: 'MCP endpoint does not provide an SSE GET stream.',
        preAuth: createOriginGuard(originMatcher),
        handler: methodNotAllowed,
      }),
      defineRoute({
        method: 'DELETE',
        path: AGENT_ACCESS_MCP_PATH,
        description: 'MCP endpoint does not provide DELETE session operations.',
        preAuth: createOriginGuard(originMatcher),
        handler: methodNotAllowed,
      }),
      defineRoute({
        method: 'POST',
        path: AGENT_ACCESS_MCP_PATH,
        description: 'Stateless Streamable HTTP MCP endpoint for agent-access tools.',
        auth: AUTH_AGENT_ACCESS,
        preAuth: createOriginGuard(originMatcher),
        errorHandler,
        handler: async (request, reply) => {
          const context = requireAgentAccessContext(request);
          const server = buildAgentAccessMcpServer({context, tools, rateLimiter, recordCall});
          // No sessionIdGenerator selects the SDK's stateless transport mode.
          const transport = new StreamableHTTPServerTransport();
          let connected = false;
          let cleanedUp = false;

          const cleanup = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            void transport.close().catch((error) => {
              logger().error({err: error}, 'Failed to close agent-access transport');
              reportError(error, {
                boundary: 'agent-access.mcp',
                operation: 'close-transport',
              });
            });
            if (connected) {
              void server.close().catch((error) => {
                logger().error({err: error}, 'Failed to close agent-access server');
                reportError(error, {
                  boundary: 'agent-access.mcp',
                  operation: 'close-server',
                });
              });
            }
          };

          reply.raw.once('close', cleanup);
          try {
            await server.connect(transport as unknown as Transport);
            connected = true;
            reply.hijack();
            await transport.handleRequest(request.raw, reply.raw, request.body);
          } catch (error) {
            cleanup();
            throw error;
          }
        },
      }),
    ],
  };
}

function methodNotAllowed(_request: FastifyRequest, reply: FastifyReply) {
  return reply.code(405).header('allow', 'POST').send({code: 'method-not-allowed'});
}

function createOriginGuard(
  isOriginAllowed: (origin: string | undefined) => boolean,
): RoutePreHandler {
  return async (request, reply) => {
    if (isOriginAllowed(request.headers.origin)) return;
    recordAgentAccessAuthFailure('origin-not-allowed');
    await reply.code(403).send({code: 'origin-not-allowed'});
  };
}

function createAgentAccessErrorHandler(resourceMetadataUrl: string) {
  const challenge = `Bearer scope="read", resource_metadata="${escapeHeaderValue(resourceMetadataUrl)}"`;

  return (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const status = errorStatus(error);
    const reason = authFailureReason(error, status, request);
    if (reason !== undefined) recordAgentAccessAuthFailure(reason);
    if (status === 401) reply.header('www-authenticate', challenge);
    return defaultErrorHandler(error, request, reply);
  };
}

function resourceMetadataUrl(options: CreateAgentAccessRoutesOptions): string {
  if (options.protectedResourceMetadataUrl !== undefined) {
    return options.protectedResourceMetadataUrl;
  }
  if (options.apiPublicUrl === undefined) return AGENT_ACCESS_PROTECTED_RESOURCE_METADATA_PATH;
  return `${options.apiPublicUrl.replace(TRAILING_SLASHES_RE, '')}${AGENT_ACCESS_PROTECTED_RESOURCE_METADATA_PATH}`;
}

function escapeHeaderValue(value: string): string {
  return value.replace(/[\\"\r\n]/gu, (character) => {
    if (character === '\r' || character === '\n') return '';
    return `\\${character}`;
  });
}

function errorStatus(error: unknown): number | undefined {
  if (error instanceof ClientError) return error.status ?? 400;
  if (isRecord(error) && typeof error.statusCode === 'number') return error.statusCode;
  return undefined;
}

function authFailureReason(
  error: unknown,
  status: number | undefined,
  request: FastifyRequest,
): 'missing' | 'invalid' | 'dependency-unavailable' | undefined {
  if (isRecord(error) && error.code === 'auth-dependency-unavailable') {
    return 'dependency-unavailable';
  }
  if (status !== 401) return undefined;
  return request.headers.authorization === undefined ? 'missing' : 'invalid';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
