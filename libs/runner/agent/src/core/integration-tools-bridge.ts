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

export interface IntegrationToolsBridgeRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeout?: number;
}

export interface IntegrationToolsBridge {
  readonly name: string;
  readonly server: McpServer;
  listTools(options?: IntegrationToolsBridgeRequestOptions): Promise<ListToolsResult>;
  callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  activateHttp(): Promise<URL>;
  close(): Promise<void>;
}

export function createIntegrationToolsBridge(params: {
  url: URL;
  fetch: typeof fetch;
  name: string;
  preferredPort?: number;
}): IntegrationToolsBridge {
  const createClient = () => new Client({name: params.name, version: '0.0.0'});
  const createTransport = () =>
    new StreamableHTTPClientTransport(params.url, {fetch: params.fetch});
  let client = createClient();
  let transport = createTransport();
  const server = new McpServer({name: params.name, version: '0.0.0'}, {capabilities: {tools: {}}});
  let connectPromise: Promise<void> | undefined;
  let resetPromise: Promise<void> | undefined;
  let activationPromise: Promise<URL> | undefined;
  let closePromise: Promise<void> | undefined;
  let closed = false;
  let httpServer: HttpServer | undefined;
  const httpSessions = new Map<string, HttpSession>();

  const resetConnection = (failedClient: Client): Promise<void> => {
    if (closed || client !== failedClient) return Promise.resolve();
    resetPromise ??= (async () => {
      connectPromise = undefined;
      await failedClient.close().catch(() => undefined);
      if (!closed && client === failedClient) {
        client = createClient();
        transport = createTransport();
      }
    })().finally(() => {
      resetPromise = undefined;
    });
    return resetPromise;
  };

  const ensureConnected = async (options?: IntegrationToolsBridgeRequestOptions) => {
    if (closed) throw new Error('Integration tools bridge is closed.');
    await resetPromise;
    if (closed) throw new Error('Integration tools bridge is closed.');
    if (connectPromise !== undefined) return connectPromise;

    const connectingClient = client;
    const connectingTransport = transport;
    let pendingConnection: Promise<void>;
    pendingConnection = connectingClient
      .connect(connectingTransport as unknown as Transport, options)
      .catch(async (error: unknown) => {
        if (connectPromise === pendingConnection) connectPromise = undefined;
        await resetConnection(connectingClient);
        throw error;
      });
    connectPromise = pendingConnection;
    return pendingConnection;
  };

  const bridge: IntegrationToolsBridge = {
    name: params.name,
    server,
    async listTools(options) {
      await ensureConnected(options);
      const requestClient = client;
      try {
        return await requestClient.listTools(undefined, options);
      } catch (error) {
        await resetConnection(requestClient);
        throw error;
      }
    },
    async callTool(name, args) {
      await ensureConnected();
      const requestClient = client;
      try {
        return (await requestClient.callTool(
          {name, ...(args === undefined ? {} : {arguments: args})},
          CallToolResultSchema,
        )) as CallToolResult;
      } catch (error) {
        await resetConnection(requestClient);
        throw error;
      }
    },
    activateHttp() {
      if (closePromise !== undefined) {
        return Promise.reject(new Error('Integration tools bridge is closed.'));
      }
      activationPromise ??= activateBridgeHttp({
        server,
        setHttpServer: (value) => (httpServer = value),
        ...(params.preferredPort === undefined ? {} : {preferredPort: params.preferredPort}),
        createHttpSession: async () => {
          const id = crypto.randomUUID();
          const sessionServer = new Server(
            {name: params.name, version: '0.0.0'},
            {capabilities: {tools: {}}},
          );
          installForwardingHandlers(sessionServer, ensureConnected, () => client, resetConnection);
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
      closed = true;
      closePromise ??= closeBridge({
        activationPromise,
        getClient: () => client,
        server,
        getHttpServer: () => httpServer,
        httpSessions,
      });
      return closePromise;
    },
  };

  installForwardingHandlers(server.server, ensureConnected, () => client, resetConnection);

  return bridge;
}

async function activateBridgeHttp(params: {
  server: McpServer;
  setHttpServer: (server: HttpServer) => void;
  preferredPort?: number;
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
    try {
      await listenHttpServer(httpServer, params.preferredPort ?? 0);
    } catch (error) {
      if (params.preferredPort === undefined || !isAddressInUseError(error)) throw error;
      logger().warn(
        {err: error, port: params.preferredPort},
        'Stable MCP bridge port is unavailable; using an ephemeral port',
      );
      await listenHttpServer(httpServer, 0);
    }
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

async function listenHttpServer(server: HttpServer, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      server.removeListener('listening', onListening);
      server.removeListener('error', onError);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    server.once('listening', onListening);
    server.once('error', onError);
    try {
      server.listen(port, '127.0.0.1');
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function isAddressInUseError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
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
  getClient: () => Client,
  resetConnection: (failedClient: Client) => Promise<void>,
): void {
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    await ensureConnected();
    const requestClient = getClient();
    try {
      return await requestClient.listTools(request.params);
    } catch (error) {
      await resetConnection(requestClient);
      throw error;
    }
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    await ensureConnected();
    const requestClient = getClient();
    try {
      return await requestClient.callTool(request.params, CallToolResultSchema);
    } catch (error) {
      await resetConnection(requestClient);
      throw error;
    }
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
  getClient: () => Client;
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
    client: params.getClient(),
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
