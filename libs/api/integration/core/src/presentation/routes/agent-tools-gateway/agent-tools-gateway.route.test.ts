import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {
  AUTH_LEASED_JOB,
  type LeasedJobContext,
  setLeasedJobContext,
} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {IntegrationProviderError} from '#core/errors.js';
import {
  agentStepConfig,
  catalogTool,
  connection,
  leaseContext,
  materializedIntegration,
  registryWithAgentTools,
} from '#test/agent-tools-gateway-helpers.js';
import {createAgentToolsGatewayRoutes} from './index.js';

let leases = new Map<string, LeasedJobContext>();

const fakeLeaseAuth: AuthMethod = {
  name: AUTH_LEASED_JOB,
  authenticate: (request: FastifyRequest) => {
    const authorization = request.headers.authorization;
    const token =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : null;
    const lease = token ? leases.get(token) : undefined;
    if (!lease) {
      throw new ClientError('Invalid job lease token', 'unauthorized', {status: 401});
    }

    setLeasedJobContext(request, lease);
    return Promise.resolve();
  },
};

describe('agent tools gateway route', () => {
  beforeEach(async () => {
    await closeApp();
    leases = new Map();
  });

  afterEach(async () => {
    await closeApp();
  });

  it('requires lease auth before resolving tools', async () => {
    const app = await createGatewayApp();

    const res = await app.inject({
      method: 'POST',
      url: '/runs/jobs/current/integration-tools/mcp',
      payload: {},
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns a normal HTTP error for pre-hijack resolution failures', async () => {
    const lease = leaseContext({currentStepId: undefined, currentStepAttempt: undefined});
    leases.set('lease-without-step', lease);
    const app = await createGatewayApp();

    const res = await app.inject({
      method: 'POST',
      url: '/runs/jobs/current/integration-tools/mcp',
      headers: {authorization: 'Bearer lease-without-step'},
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('lease-missing-step');
  });

  it('serves MCP over stateless Streamable HTTP after resolving server-side state', async () => {
    const lease = leaseContext({workspaceId: 'workspace-1'});
    const integration = materializedIntegration({connectionId: 'connection-1'});
    const calls: unknown[] = [];
    const sessionTools: unknown[] = [];
    const close = vi.fn();
    leases.set('valid-lease', lease);
    const app = await createGatewayApp({
      registry: registryWithAgentTools([catalogTool()], {
        onOpenSession: (input) => sessionTools.push(...input.tools),
        onCall: (call) => calls.push(call),
        onClose: close,
      }),
      loadLeasedAgentStep: async () => ({
        workspaceId: lease.workspaceId,
        step: {type: 'agent', config: agentStepConfig([integration])},
      }),
      getIntegrationConnectionById: async () =>
        connection({
          id: integration.connectionId,
          workspaceId: lease.workspaceId,
          slug: integration.connectionSlug,
        }),
    });
    const address = await app.listen({port: 0, host: '127.0.0.1'});
    const client = new Client({name: 'test-http-client', version: '0.0.0'});
    const transport = new StreamableHTTPClientTransport(
      new URL('/runs/jobs/current/integration-tools/mcp', address),
      {
        requestInit: {
          headers: {authorization: 'Bearer valid-lease'},
        },
      },
    );

    await client.connect(transport as unknown as Transport);
    const tools = await client.listTools();
    const result = await client.callTool(
      {
        name: 'github_main__issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      },
      CallToolResultSchema,
    );
    await client.close();

    expect(tools.tools.map((tool) => tool.name)).toEqual(['github_main__issue_read']);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: 'dispatched',
      provider: 'github',
      connection_id: 'connection-1',
      tool_id: 'issue_read',
      method: 'get',
    });
    expect(calls).toEqual([
      {
        toolId: 'issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      },
    ]);
    expect(sessionTools).toMatchObject([
      {
        methods: [
          {id: 'get', description: 'Get one issue.'},
          {id: 'get_comments', description: 'Get issue comments.'},
        ],
      },
    ]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns bounded MCP errors when provider dispatch times out', async () => {
    const lease = leaseContext({workspaceId: 'workspace-1'});
    const integration = materializedIntegration({connectionId: 'connection-1'});
    const timeout = new Error('request timeout after 30s');
    timeout.name = 'TimeoutError';
    const close = vi.fn();
    leases.set('timeout-lease', lease);
    const app = await createGatewayApp({
      registry: registryWithAgentTools([catalogTool()], {callError: timeout, onClose: close}),
      loadLeasedAgentStep: async () => ({
        workspaceId: lease.workspaceId,
        step: {type: 'agent', config: agentStepConfig([integration])},
      }),
      getIntegrationConnectionById: async () =>
        connection({
          id: integration.connectionId,
          workspaceId: lease.workspaceId,
          slug: integration.connectionSlug,
        }),
    });
    const address = await app.listen({port: 0, host: '127.0.0.1'});
    const client = new Client({name: 'test-http-client', version: '0.0.0'});
    const transport = new StreamableHTTPClientTransport(
      new URL('/runs/jobs/current/integration-tools/mcp', address),
      {
        requestInit: {
          headers: {authorization: 'Bearer timeout-lease'},
        },
      },
    );

    await client.connect(transport as unknown as Transport);
    const result = await client.callTool(
      {
        name: 'github_main__issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      },
      CallToolResultSchema,
    );
    await client.close();

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'Integration provider timed out'}],
      structuredContent: {code: 'provider-timeout'},
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('classifies the MCP SDK request timeout shape as a provider timeout', async () => {
    const lease = leaseContext({workspaceId: 'workspace-1'});
    const integration = materializedIntegration({connectionId: 'connection-1'});
    const timeout = new Error('MCP error -32001: Request timed out');
    timeout.name = 'McpError';
    leases.set('mcp-timeout-lease', lease);
    const app = await createGatewayApp({
      registry: registryWithAgentTools([catalogTool()], {callError: timeout}),
      loadLeasedAgentStep: async () => ({
        workspaceId: lease.workspaceId,
        step: {type: 'agent', config: agentStepConfig([integration])},
      }),
      getIntegrationConnectionById: async () =>
        connection({
          id: integration.connectionId,
          workspaceId: lease.workspaceId,
          slug: integration.connectionSlug,
        }),
    });

    const result = await callIssueReadTool(app, 'mcp-timeout-lease');

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'Integration provider timed out'}],
      structuredContent: {code: 'provider-timeout'},
    });
  });

  it('returns the provider message and terminal code for rejected calls', async () => {
    const lease = leaseContext({workspaceId: 'workspace-1'});
    const integration = materializedIntegration({connectionId: 'connection-1'});
    leases.set('provider-error-lease', lease);
    const providerError = new IntegrationProviderError(
      'provider-rejected',
      'commit_id is missing',
      undefined,
      422,
    );
    const app = await createGatewayApp({
      registry: registryWithAgentTools([catalogTool()], {
        callError: providerError,
      }),
      loadLeasedAgentStep: async () => ({
        workspaceId: lease.workspaceId,
        step: {type: 'agent', config: agentStepConfig([integration])},
      }),
      getIntegrationConnectionById: async () =>
        connection({
          id: integration.connectionId,
          workspaceId: lease.workspaceId,
          slug: integration.connectionSlug,
        }),
    });
    const address = await app.listen({port: 0, host: '127.0.0.1'});
    const client = new Client({name: 'test-http-client', version: '0.0.0'});
    const transport = new StreamableHTTPClientTransport(
      new URL('/runs/jobs/current/integration-tools/mcp', address),
      {
        requestInit: {
          headers: {authorization: 'Bearer provider-error-lease'},
        },
      },
    );

    await client.connect(transport as unknown as Transport);
    const result = await client.callTool(
      {
        name: 'github_main__issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      },
      CallToolResultSchema,
    );
    await client.close();

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'commit_id is missing'}],
      structuredContent: {code: 'provider-rejected', status: 422},
    });
  });

  it('returns bounded MCP errors when provider credentials are unavailable', async () => {
    const lease = leaseContext({workspaceId: 'workspace-1'});
    const integration = materializedIntegration({connectionId: 'connection-1'});
    const tokenError = new Error('missing token for connection-1');
    tokenError.name = 'LinearAccessTokenMissingError';
    leases.set('credential-error-lease', lease);
    const app = await createGatewayApp({
      registry: registryWithAgentTools([catalogTool()], {openSessionError: tokenError}),
      loadLeasedAgentStep: async () => ({
        workspaceId: lease.workspaceId,
        step: {type: 'agent', config: agentStepConfig([integration])},
      }),
      getIntegrationConnectionById: async () =>
        connection({
          id: integration.connectionId,
          workspaceId: lease.workspaceId,
          slug: integration.connectionSlug,
        }),
    });
    const address = await app.listen({port: 0, host: '127.0.0.1'});
    const client = new Client({name: 'test-http-client', version: '0.0.0'});
    const transport = new StreamableHTTPClientTransport(
      new URL('/runs/jobs/current/integration-tools/mcp', address),
      {
        requestInit: {
          headers: {authorization: 'Bearer credential-error-lease'},
        },
      },
    );

    await client.connect(transport as unknown as Transport);
    const result = await client.callTool(
      {
        name: 'github_main__issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      },
      CallToolResultSchema,
    );
    await client.close();

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'Integration provider credentials are unavailable'}],
      structuredContent: {code: 'credentials-unavailable'},
    });
  });
});

async function createGatewayApp(
  overrides: Partial<Parameters<typeof createAgentToolsGatewayRoutes>[0]> = {},
): Promise<FastifyInstance> {
  const app = await createApp({
    auth: [fakeLeaseAuth],
    routes: [
      createAgentToolsGatewayRoutes({
        registry: registryWithAgentTools(),
        getIntegrationConnectionById: async () =>
          connection({workspaceId: 'workspace-1', id: 'connection-1'}),
        loadLeasedAgentStep: async () => ({
          workspaceId: 'workspace-1',
          step: {type: 'agent', config: agentStepConfig()},
        }),
        ...overrides,
      }),
    ],
    swagger: false,
  });
  await app.ready();
  return app;
}

async function callIssueReadTool(app: FastifyInstance, leaseToken: string) {
  const address = await app.listen({port: 0, host: '127.0.0.1'});
  const client = new Client({name: 'test-http-client', version: '0.0.0'});
  const transport = new StreamableHTTPClientTransport(
    new URL('/runs/jobs/current/integration-tools/mcp', address),
    {
      requestInit: {
        headers: {authorization: `Bearer ${leaseToken}`},
      },
    },
  );

  await client.connect(transport as unknown as Transport);
  const result = await client.callTool(
    {
      name: 'github_main__issue_read',
      arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
    },
    CallToolResultSchema,
  );
  await client.close();

  return result;
}
