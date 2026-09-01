import {once} from 'node:events';
import {createServer, type Server as HttpServer, Server as NodeHttpServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {createIntegrationToolsBridge} from '#core/integration-tools-bridge.js';

describe('createIntegrationToolsBridge', () => {
  let gateway: FakeGateway | undefined;

  afterEach(async () => {
    await gateway?.close();
    gateway = undefined;
  });

  it('lists tools and forwards calls to the gateway with the current lease token', async () => {
    let leaseToken = 'lease-initial';
    gateway = await startFakeGateway(() => leaseToken);
    const bridge = createIntegrationToolsBridge({
      name: 'shipfox_integration_tools',
      url: gateway.url,
      fetch: leaseFetch(() => leaseToken),
    });

    const tools = await bridge.listTools();
    leaseToken = 'lease-next';
    const result = await bridge.callTool('github_main__issue_read', {
      method: 'get',
      owner: 'shipfox',
      repo: 'platform',
      issue_number: 1,
    });
    await bridge.close();

    expect(tools.tools.map((tool) => tool.name)).toEqual(['github_main__issue_read']);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      name: 'github_main__issue_read',
      method: 'get',
      issue_number: 1,
    });
    expect(gateway.authorizations).toContain('Bearer lease-initial');
    expect(gateway.authorizations.at(-1)).toBe('Bearer lease-next');
    expect(gateway.calls).toEqual([
      {
        name: 'github_main__issue_read',
        arguments: {
          method: 'get',
          owner: 'shipfox',
          repo: 'platform',
          issue_number: 1,
        },
      },
    ]);
  });

  it('recovers after a transient connection failure', async () => {
    gateway = await startFakeGateway(() => 'lease');
    let failNextRequest = true;
    const bridge = createIntegrationToolsBridge({
      name: 'shipfox_integration_tools',
      url: gateway.url,
      fetch: (input, init) => {
        if (failNextRequest) {
          failNextRequest = false;
          return Promise.resolve(new Response('temporarily unavailable', {status: 503}));
        }
        return leaseFetch(() => 'lease')(input, init);
      },
    });

    await expect(bridge.listTools({timeout: 100})).rejects.toThrow();
    const tools = await bridge.listTools();
    await bridge.close();

    expect(tools.tools.map((tool) => tool.name)).toEqual(['github_main__issue_read']);
  });

  it('recreates the client after a connected request failure', async () => {
    gateway = await startFakeGateway(() => 'lease');
    let failNextListRequest = true;
    const fallbackFetch = leaseFetch(() => 'lease');
    const bridge = createIntegrationToolsBridge({
      name: 'shipfox_integration_tools',
      url: gateway.url,
      fetch: (input, init) => {
        const body =
          typeof init?.body === 'string' ? (JSON.parse(init.body) as {method?: string}) : undefined;
        if (failNextListRequest && body?.method === 'tools/list') {
          failNextListRequest = false;
          return Promise.resolve(new Response('temporarily unavailable', {status: 503}));
        }
        return fallbackFetch(input, init);
      },
    });

    await expect(bridge.listTools()).rejects.toThrow();
    const result = await bridge.callTool('github_main__issue_read', {issue_number: 1});
    await bridge.close();

    expect(result.structuredContent).toEqual({
      name: 'github_main__issue_read',
      method: undefined,
      issue_number: 1,
    });
  });

  it('relays list and call through the in-process MCP server', async () => {
    let leaseToken = 'lease-initial';
    gateway = await startFakeGateway(() => leaseToken);
    const bridge = createIntegrationToolsBridge({
      name: 'shipfox_integration_tools',
      url: gateway.url,
      fetch: leaseFetch(() => leaseToken),
    });
    const client = new Client({name: 'test-client', version: '0.0.0'});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await bridge.server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    leaseToken = 'lease-next';
    const result = await client.callTool(
      {
        name: 'github_main__issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 2},
      },
      CallToolResultSchema,
    );
    await client.close();
    await bridge.close();

    expect(tools.tools.map((tool) => tool.name)).toEqual(['github_main__issue_read']);
    expect(result.structuredContent).toEqual({
      name: 'github_main__issue_read',
      method: 'get',
      issue_number: 2,
    });
    expect(gateway.authorizations).toContain('Bearer lease-initial');
    expect(gateway.authorizations.at(-1)).toBe('Bearer lease-next');
  });

  it('serves the MCP bridge over one loopback endpoint', async () => {
    let leaseToken = 'lease-initial';
    gateway = await startFakeGateway(() => leaseToken);
    const authToken = 'claude-invocation-secret';
    const bridge = createIntegrationToolsBridge({
      name: 'shipfox_integration_tools',
      url: gateway.url,
      fetch: leaseFetch(() => leaseToken),
    });

    const [endpoint, concurrentEndpoint] = await Promise.all([
      bridge.activateHttp({authToken}),
      bridge.activateHttp({authToken}),
    ]);
    const requestInit = {headers: {Authorization: `Bearer ${authToken}`}};
    const unauthorized = await fetch(endpoint);
    const probe = new Client({name: 'pi-mcp-probe', version: '2.1.2'});
    await probe.connect(
      new StreamableHTTPClientTransport(endpoint, {requestInit}) as unknown as Transport,
    );
    await probe.close();
    const client = new Client({name: 'test-client', version: '0.0.0'});
    const transport = new StreamableHTTPClientTransport(endpoint, {requestInit});
    await client.connect(transport as unknown as Transport);
    const tools = await client.listTools();
    leaseToken = 'lease-next';
    const result = await client.callTool(
      {
        name: 'github_main__issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 3},
      },
      CallToolResultSchema,
    );
    const invalidPath = await fetch(new URL('/other', endpoint));
    const invalidOrigin = await fetch(endpoint, {
      headers: {...requestInit.headers, Origin: 'http://outside.example.test'},
    });
    await client.close();
    await bridge.close();

    expect(endpoint).toEqual(concurrentEndpoint);
    expect(endpoint.hostname).toBe('127.0.0.1');
    expect(endpoint.pathname).toBe('/mcp');
    expect(tools.tools.map((tool) => tool.name)).toEqual(['github_main__issue_read']);
    expect(result.structuredContent).toEqual({
      name: 'github_main__issue_read',
      method: 'get',
      issue_number: 3,
    });
    expect(gateway.authorizations.at(-1)).toBe('Bearer lease-next');
    expect(unauthorized.status).toBe(401);
    expect(invalidPath.status).toBe(404);
    expect(invalidOrigin.status).toBe(403);
  });

  it('cancels activation and releases the HTTP bridge resources', async () => {
    gateway = await startFakeGateway(() => 'lease');
    const bridge = createIntegrationToolsBridge({
      name: 'shipfox_integration_tools',
      url: gateway.url,
      fetch: leaseFetch(() => 'lease'),
    });
    const ac = new AbortController();
    ac.abort(new Error('activation cancelled'));

    await expect(bridge.activateHttp({signal: ac.signal, timeout: 10_000})).rejects.toThrow(
      'activation cancelled',
    );
    await expect(bridge.close()).resolves.toBeUndefined();
  });

  it('cancels an in-flight activation before closing the bridge', async () => {
    gateway = await startFakeGateway(() => 'lease');
    const bridge = createIntegrationToolsBridge({
      name: 'shipfox_integration_tools',
      url: gateway.url,
      fetch: leaseFetch(() => 'lease'),
    });
    const listen = vi.spyOn(NodeHttpServer.prototype, 'listen').mockImplementation(function (
      this: NodeHttpServer,
    ) {
      return this;
    });
    const ac = new AbortController();

    try {
      const activation = bridge.activateHttp({signal: ac.signal, timeout: 10_000});
      ac.abort(new Error('activation cancelled'));

      await expect(activation).rejects.toThrow('activation cancelled');
      await expect(bridge.close()).resolves.toBeUndefined();
    } finally {
      listen.mockRestore();
    }
  });

  it('reuses a preferred loopback port after a bridge is recreated', async () => {
    gateway = await startFakeGateway(() => 'lease');
    const first = createIntegrationToolsBridge({
      name: 'shipfox_integration_tools',
      url: gateway.url,
      fetch: leaseFetch(() => 'lease'),
    });
    const firstEndpoint = await first.activateHttp();
    await first.close();

    const second = createIntegrationToolsBridge({
      name: 'shipfox_integration_tools',
      url: gateway.url,
      fetch: leaseFetch(() => 'lease'),
      preferredPort: Number(firstEndpoint.port),
    });
    const secondEndpoint = await second.activateHttp();
    await second.close();

    expect(secondEndpoint.port).toBe(firstEndpoint.port);
  });

  it('allows repeated close before activation', async () => {
    gateway = await startFakeGateway(() => 'lease');
    const bridge = createIntegrationToolsBridge({
      name: 'shipfox_integration_tools',
      url: gateway.url,
      fetch: leaseFetch(() => 'lease'),
    });

    await Promise.all([bridge.close(), bridge.close()]);

    await expect(bridge.activateHttp()).rejects.toThrow('closed');
  });
});

interface FakeGateway {
  url: URL;
  authorizations: string[];
  calls: Array<{name: string; arguments: Record<string, unknown> | undefined}>;
  close(): Promise<void>;
}

async function startFakeGateway(expectedLeaseToken: () => string): Promise<FakeGateway> {
  const authorizations: string[] = [];
  const calls: Array<{name: string; arguments: Record<string, unknown> | undefined}> = [];
  const httpServer = createServer(async (request, response) => {
    const authorization = request.headers.authorization ?? '';
    authorizations.push(authorization);
    if (authorization !== `Bearer ${expectedLeaseToken()}`) {
      response.writeHead(401).end();
      return;
    }

    const body = await readJsonBody(request);
    const server = new Server(
      {name: 'fake-integration-tools', version: '0.0.0'},
      {capabilities: {tools: {}}},
    );
    const transport = new StreamableHTTPServerTransport();

    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [
        {
          name: 'github_main__issue_read',
          description: 'Read issue metadata from GitHub.',
          inputSchema: {type: 'object'},
        },
      ],
    }));
    server.setRequestHandler(CallToolRequestSchema, (toolRequest) => {
      calls.push({
        name: toolRequest.params.name,
        arguments: toolRequest.params.arguments,
      });
      return {
        content: [{type: 'text', text: 'called'}],
        structuredContent: {
          name: toolRequest.params.name,
          method: toolRequest.params.arguments?.method,
          issue_number: toolRequest.params.arguments?.issue_number,
        },
      };
    });

    await server.connect(transport as unknown as Transport);
    response.on('close', () => {
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(request, response, body);
  });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');

  return {
    url: new URL('/runs/jobs/current/integration-tools/mcp', address(httpServer)),
    authorizations,
    calls,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

function leaseFetch(leaseToken: () => string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${leaseToken()}`);
    return fetch(input, {...init, headers});
  };
}

function address(server: HttpServer): string {
  const addressInfo = server.address();
  if (typeof addressInfo !== 'object' || addressInfo === null) {
    throw new Error('Fake gateway did not bind a TCP address.');
  }
  return `http://127.0.0.1:${addressInfo.port}`;
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? undefined : (JSON.parse(text) as unknown);
}
