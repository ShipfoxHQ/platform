import {once} from 'node:events';
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  CallToolResultSchema,
  ListToolsRequestSchema,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import {logger} from '@shipfox/node-opentelemetry';

const MAX_MCP_REQUEST_BYTES = 1_048_576;
const MCP_REQUEST_TIMEOUT_MS = 30_000;

export interface IntegrationToolsBridge {
  readonly name: string;
  readonly server: McpServer;
  listTools(): Promise<ListToolsResult>;
  callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  activateHttp(): Promise<URL>;
  close(): Promise<void>;
}

export function createIntegrationToolsBridge(params: {
  url: URL;
  fetch: typeof fetch;
  name: string;
}): IntegrationToolsBridge {
  const client = new Client({name: params.name, version: '0.0.0'});
  const transport = new StreamableHTTPClientTransport(params.url, {fetch: params.fetch});
  const server = new McpServer({name: params.name, version: '0.0.0'}, {capabilities: {tools: {}}});
  let connectPromise: Promise<void> | undefined;
  let activationPromise: Promise<URL> | undefined;
  let closePromise: Promise<void> | undefined;
  let httpServer: HttpServer | undefined;
  const httpSessions = new Map<string, HttpSession>();

  const ensureConnected = () => {
    connectPromise ??= client.connect(transport as unknown as Transport);
    return connectPromise;
  };

  const bridge: IntegrationToolsBridge = {
    name: params.name,
    server,
    async listTools() {
      await ensureConnected();
      return client.listTools();
    },
    async callTool(name, args) {
      await ensureConnected();
      return client.callTool(
        {name, ...(args === undefined ? {} : {arguments: args})},
        CallToolResultSchema,
      ) as Promise<CallToolResult>;
    },
    activateHttp() {
      if (closePromise !== undefined) {
        return Promise.reject(new Error('Integration tools bridge is closed.'));
      }
      activationPromise ??= activateBridgeHttp({
        server,
        setHttpServer: (value) => (httpServer = value),
        createHttpSession: async () => {
          const id = crypto.randomUUID();
          const sessionServer = new Server(
            {name: params.name, version: '0.0.0'},
            {capabilities: {tools: {}}},
          );
          installForwardingHandlers(sessionServer, ensureConnected, client);
          const sessionTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => id,
          });
          await sessionServer.connect(sessionTransport as unknown as Transport);
          return {id, server: sessionServer, transport: sessionTransport};
        },
        httpSessions,
      });
      return activationPromise;
    },
    close() {
      closePromise ??= closeBridge({
        activationPromise,
        client,
        server,
        getHttpServer: () => httpServer,
        httpSessions,
      });
      return closePromise;
    },
  };

  installForwardingHandlers(server.server, ensureConnected, client);

  return bridge;
}

async function activateBridgeHttp(params: {
  server: McpServer;
  setHttpServer: (server: HttpServer) => void;
  createHttpSession: () => Promise<HttpSession>;
  httpSessions: Map<string, HttpSession>;
}): Promise<URL> {
  const httpServer = createServer((request, response) => {
    void handleHttpRequest(request, response, params.httpSessions, params.createHttpSession);
  });
  httpServer.headersTimeout = MCP_REQUEST_TIMEOUT_MS;
  httpServer.requestTimeout = MCP_REQUEST_TIMEOUT_MS;
  params.setHttpServer(httpServer);

  try {
    httpServer.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    const address = httpServer.address();
    if (typeof address !== 'object' || address === null) {
      throw new Error('Integration tools bridge did not bind a TCP address.');
    }
    return new URL(`http://127.0.0.1:${address.port}/mcp`);
  } catch (error) {
    try {
      await releaseResources({
        server: params.server,
        httpServer,
        httpSessions: params.httpSessions,
      });
    } catch (cleanupError) {
      logger().warn({err: cleanupError}, 'Failed to clean up an inactive MCP bridge');
    }
    throw error;
  }
}

interface HttpSession {
  readonly id: string;
  readonly server: Server;
  readonly transport: StreamableHTTPServerTransport;
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  sessions: Map<string, HttpSession>,
  createHttpSession: () => Promise<HttpSession>,
): Promise<void> {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (requestUrl.pathname !== '/mcp') {
    sendMcpError(response, 404, -32600, 'Invalid MCP endpoint.');
    return;
  }

  if (!isLoopbackRequest(request)) {
    sendMcpError(response, 403, -32600, 'MCP endpoint accepts loopback requests only.');
    return;
  }
  if (
    request.headers['content-length'] !== undefined &&
    Number(request.headers['content-length']) > MAX_MCP_REQUEST_BYTES
  ) {
    sendMcpError(response, 413, -32600, 'MCP request is too large.');
    return;
  }

  try {
    const body = request.method === 'POST' ? await readJsonBody(request) : undefined;
    const sessionId = request.headers['mcp-session-id'];
    let session: HttpSession | undefined;
    if (isInitializeRequest(body)) session = await createHttpSession();
    else if (typeof sessionId === 'string') session = sessions.get(sessionId);
    if (session === undefined) {
      sendMcpError(response, 404, -32600, 'Unknown MCP session.');
      return;
    }
    if (isInitializeRequest(body)) sessions.set(session.id, session);
    await session.transport.handleRequest(request, response, body);
    if (request.method === 'DELETE') {
      response.once('finish', () => {
        void closeHttpSession(session, sessions).catch((error) => {
          logger().warn({err: error}, 'Failed to close MCP HTTP session');
        });
      });
    }
  } catch (error) {
    logger().warn({err: error}, 'MCP bridge request failed');
    if (!response.headersSent) sendMcpError(response, 500, -32603, 'MCP request failed.');
    else response.end();
  }
}

function installForwardingHandlers(
  server: Server,
  ensureConnected: () => Promise<void>,
  client: Client,
): void {
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    await ensureConnected();
    return client.listTools(request.params);
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    await ensureConnected();
    return client.callTool(request.params, CallToolResultSchema);
  });
}

function isInitializeRequest(body: unknown): boolean {
  return (
    typeof body === 'object' && body !== null && 'method' in body && body.method === 'initialize'
  );
}

function isLoopbackRequest(request: IncomingMessage): boolean {
  const host = request.headers.host;
  if (host === undefined || !host.startsWith('127.0.0.1:')) return false;
  const origin = request.headers.origin;
  return origin === undefined || origin === `http://${host}`;
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.length;
    if (byteLength > MAX_MCP_REQUEST_BYTES) throw new Error('MCP request is too large.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function sendMcpError(
  response: ServerResponse,
  statusCode: number,
  code: number,
  message: string,
): void {
  response
    .writeHead(statusCode, {'Content-Type': 'application/json'})
    .end(JSON.stringify({jsonrpc: '2.0', error: {code, message}, id: null}));
}

async function closeBridge(params: {
  activationPromise: Promise<URL> | undefined;
  client: Client;
  server: McpServer;
  getHttpServer: () => HttpServer | undefined;
  httpSessions: Map<string, HttpSession>;
}): Promise<void> {
  try {
    await params.activationPromise;
  } catch {
    // Activation has already released its partially created resources.
  }

  const httpServer = params.getHttpServer();
  await releaseResources({
    client: params.client,
    server: params.server,
    httpSessions: params.httpSessions,
    ...(httpServer === undefined ? {} : {httpServer}),
  });
}

async function releaseResources(params: {
  client?: Client;
  server: McpServer;
  httpServer?: HttpServer;
  httpSessions?: Map<string, HttpSession>;
}): Promise<void> {
  const httpSessions = params.httpSessions;
  const results = await Promise.allSettled([
    ...(params.client === undefined ? [] : [params.client.close()]),
    params.server.close(),
    ...(httpSessions === undefined
      ? []
      : [...httpSessions.values()].map((session) => closeHttpSession(session, httpSessions))),
    ...(params.httpServer === undefined ? [] : [closeHttpServer(params.httpServer)]),
  ]);
  const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Failed to close integration tools bridge resources.');
  }
}

async function closeHttpSession(
  session: HttpSession,
  sessions: Map<string, HttpSession>,
): Promise<void> {
  sessions.delete(session.id);
  const results = await Promise.allSettled([session.server.close(), session.transport.close()]);
  const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Failed to close MCP HTTP session.');
  }
}

function closeHttpServer(server: HttpServer): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
    server.closeAllConnections();
  });
}
