import {once} from 'node:events';
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {z} from 'zod';

export const LINEAR_READ_RESULT_MARKER = 'linear-read-result-marker';
export const LINEAR_WRITE_RESULT_MARKER = 'linear-write-result-marker';

const LINEAR_MCP_PORT_WAIT_TIMEOUT_MS = 120_000;
const LINEAR_MCP_PORT_RETRY_INTERVAL_MS = 100;

export interface LinearMcpCall {
  authorization: string | undefined;
  arguments: Record<string, unknown>;
  toolName: 'get_issue' | 'save_comment';
}

export interface LinearMcpMock {
  calls: LinearMcpCall[];
  endpoint: URL;
  stop(): Promise<void>;
}

export async function startLinearMcpMock(
  endpoint = new URL(requiredLinearMcpEndpoint()),
): Promise<LinearMcpMock> {
  const calls: LinearMcpCall[] = [];
  let boundEndpoint = endpoint;
  const server = createServer((request, response) => {
    void handleMcpRequest({calls, endpoint: boundEndpoint, request, response});
  });

  try {
    boundEndpoint = await listen(server, endpoint);
  } catch (error) {
    throw new Error(`Linear MCP mock failed to start at ${endpoint}`, {cause: error});
  }

  return {
    calls,
    endpoint: boundEndpoint,
    stop: async () => {
      try {
        await close(server);
      } catch (error) {
        throw new Error(`Linear MCP mock failed to stop at ${boundEndpoint}`, {cause: error});
      }
    },
  };
}

async function handleMcpRequest(params: {
  calls: LinearMcpCall[];
  endpoint: URL;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const requestUrl = new URL(params.request.url ?? '/', params.endpoint);
  if (requestUrl.pathname !== params.endpoint.pathname) {
    sendMcpError(params.response, 404, -32600, 'Invalid MCP endpoint.');
    return;
  }
  if (params.request.method !== 'POST') {
    sendMcpError(params.response, 405, -32600, 'Method not allowed.');
    return;
  }

  try {
    const body = await readJsonBody(params.request);
    const mcp = new McpServer({name: 'linear-e2e-mock', version: '0.0.0'});
    mcp.registerTool(
      'get_issue',
      {
        description: 'Get a deterministic Linear issue.',
        inputSchema: {id: z.string()},
      },
      (arguments_) => {
        params.calls.push({
          authorization: params.request.headers.authorization,
          arguments: arguments_,
          toolName: 'get_issue',
        });
        return {content: [{type: 'text', text: LINEAR_READ_RESULT_MARKER}]};
      },
    );
    mcp.registerTool(
      'save_comment',
      {
        description: 'Save a deterministic Linear comment.',
        inputSchema: {issueId: z.string(), body: z.string()},
      },
      (arguments_) => {
        params.calls.push({
          authorization: params.request.headers.authorization,
          arguments: arguments_,
          toolName: 'save_comment',
        });
        return {content: [{type: 'text', text: LINEAR_WRITE_RESULT_MARKER}]};
      },
    );
    const transport = new StreamableHTTPServerTransport();
    await mcp.connect(transport as unknown as Transport);
    params.response.once('close', () => {
      void Promise.all([transport.close(), mcp.close()]).catch(() => undefined);
    });
    await transport.handleRequest(params.request, params.response, body);
  } catch (_error) {
    if (!params.response.headersSent)
      sendMcpError(params.response, 500, -32603, 'MCP request failed.');
    else params.response.end();
  }
}

function requiredLinearMcpEndpoint(): string {
  const endpoint = process.env.LINEAR_MCP_ENDPOINT;
  if (!endpoint) throw new Error('LINEAR_MCP_ENDPOINT must be configured for the Linear MCP mock.');
  return endpoint;
}

async function listen(server: HttpServer, endpoint: URL): Promise<URL> {
  const port = Number(endpoint.port);
  const deadline = Date.now() + LINEAR_MCP_PORT_WAIT_TIMEOUT_MS;

  while (true) {
    server.listen({host: endpoint.hostname, port});
    try {
      await once(server, 'listening');
      break;
    } catch (error) {
      if (!isAddressInUseError(error) || port === 0 || Date.now() >= deadline) throw error;
      await delay(LINEAR_MCP_PORT_RETRY_INTERVAL_MS);
    }
  }

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');
  const boundEndpoint = new URL(endpoint);
  boundEndpoint.port = String(address.port);
  return boundEndpoint;
}

function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
}

async function close(server: HttpServer): Promise<void> {
  server.close();
  await once(server, 'close');
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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
    .writeHead(statusCode, {'content-type': 'application/json'})
    .end(JSON.stringify({jsonrpc: '2.0', error: {code, message}, id: null}));
}
