import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import {
  type AgentAccessContext,
  AUTH_AGENT_ACCESS,
  setAgentAccessContext,
} from '@shipfox/api-auth-context';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {TriggersInterModuleClient} from '@shipfox/api-triggers-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {
  type AuthMethod,
  ClientError,
  closeApp,
  createApp,
  type FastifyRequest,
} from '@shipfox/node-fastify';
import {createAgentAccessRateLimiter} from '#core/rate-limiter.js';
import {type CreateAgentAccessRoutesOptions, createAgentAccessRoutes} from './routes.js';

const context: AgentAccessContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  scopes: ['read'],
  credential: {kind: 'oauth_grant', grantId: 'grant-1', clientId: 'client-1'},
};

let authCalls = 0;

const testAuth: AuthMethod = {
  name: AUTH_AGENT_ACCESS,
  authenticate: (request: FastifyRequest) => {
    authCalls += 1;
    if (request.headers.authorization !== 'Bearer valid-token') {
      throw new ClientError('Missing or invalid Authorization header', 'unauthorized', {
        status: 401,
      });
    }
    setAgentAccessContext(request, context);
    return Promise.resolve();
  },
};

describe('agent-access MCP routes', () => {
  beforeEach(async () => {
    await closeApp();
    authCalls = 0;
  });

  afterEach(async () => {
    await closeApp();
  });

  test('rejects a partial core producer composition at startup', () => {
    expect(() =>
      createAgentAccessRoutes({
        projects: {} as unknown as ProjectsModuleClient,
        definitions: {} as unknown as DefinitionsInterModuleClient,
      }),
    ).toThrow(
      'Agent-access core producer clients must be configured together: projects, definitions, workflows, annotations, and triggers',
    );
  });

  test('keeps diagnostic tools when optional log reads are not configured', async () => {
    const app = await createTestApp(createAgentAccessRateLimiter(), {
      projects: {} as unknown as ProjectsModuleClient,
      definitions: {} as unknown as DefinitionsInterModuleClient,
      workflows: {} as unknown as WorkflowsModuleClient,
      annotations: {} as unknown as AnnotationsInterModuleClient,
      triggers: {} as unknown as TriggersInterModuleClient,
    });
    const address = await app.listen({port: 0, host: '127.0.0.1'});
    const client = new Client({name: 'test-http-client', version: '0.0.0'});
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', address), {
      requestInit: {headers: {authorization: 'Bearer valid-token'}},
    });

    try {
      await client.connect(transport as unknown as Transport);
      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name);

      expect(toolNames).toEqual(
        expect.arrayContaining([
          'get_trigger_event',
          'get_trigger_event_facets',
          'get_workflow_run_source',
          'get_workflow_execution_context',
          'get_step_attempt',
          'list_workflow_run_job_explanations',
        ]),
      );
      expect(toolNames).not.toContain('get_step_logs');
    } finally {
      await client.close();
    }
  });

  test('returns 405 for allowed GET and DELETE requests', async () => {
    const app = await createTestApp();

    const getResponse = await app.inject({
      method: 'GET',
      url: '/mcp',
      headers: {origin: 'https://allowed.example.test'},
    });
    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/mcp',
      headers: {origin: 'https://allowed.example.test'},
    });

    expect(getResponse.statusCode).toBe(405);
    expect(deleteResponse.statusCode).toBe(405);
    expect(getResponse.headers.allow).toBe('POST');
    expect(deleteResponse.headers.allow).toBe('POST');
    expect(authCalls).toBe(0);
  });

  test('rejects a disallowed Origin before agent authentication', async () => {
    const app = await createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {origin: 'https://evil.example.test'},
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({code: 'origin-not-allowed'});
    expect(authCalls).toBe(0);
  });

  test('allows an Origin-less request to proceed to authentication', async () => {
    const app = await createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {authorization: 'Bearer valid-token'},
      payload: {},
    });

    expect(response.statusCode).toBe(406);
    expect(authCalls).toBe(1);
  });

  test('challenges unauthenticated requests with protected-resource metadata', async () => {
    const app = await createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {origin: 'https://allowed.example.test'},
      payload: {},
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe(
      'Bearer scope="read", resource_metadata="https://api.example.test/.well-known/oauth-protected-resource"',
    );
    expect(response.json()).toEqual({code: 'unauthorized'});
    expect(authCalls).toBe(1);
  });

  test.each([
    'http://api.example.test',
    'https://api.example.test/v1',
    'https://user:password@api.example.test',
  ])('rejects an invalid public API origin at startup: %s', (apiPublicUrl) => {
    expect(() => createAgentAccessRoutes({apiPublicUrl})).toThrow(
      'Agent-access API public URL configuration is invalid',
    );
  });

  test.each([
    'https://api.example.test/',
    'http://localhost:16101/',
    'http://127.0.0.1:16101',
    'http://[::1]:16101',
  ])('accepts a secure or loopback public API origin: %s', (apiPublicUrl) => {
    expect(() => createAgentAccessRoutes({apiPublicUrl})).not.toThrow();
  });

  test('serves stateless Streamable HTTP with the fixture tool', async () => {
    const app = await createTestApp();
    const address = await app.listen({port: 0, host: '127.0.0.1'});
    const client = new Client({name: 'test-http-client', version: '0.0.0'});
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', address), {
      requestInit: {headers: {authorization: 'Bearer valid-token'}},
    });

    await client.connect(transport as unknown as Transport);
    const tools = await client.listTools();
    const result = await client.callTool(
      {name: 'agent_access_fixture', arguments: {message: 'hello over HTTP'}},
      CallToolResultSchema,
    );
    await client.close();

    expect(tools.tools.map((tool) => tool.name)).toEqual(['agent_access_fixture']);
    expect(client.getServerVersion()?.name).toBe('shipfox');
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      ok: true,
      result: {message: 'hello over HTTP'},
    });
    expect(result.content).toEqual([
      {type: 'text', text: JSON.stringify(result.structuredContent)},
    ]);
    expect(authCalls).toBeGreaterThan(0);
  });

  test('returns an MCP tool error when the credential exceeds its window', async () => {
    const app = await createTestApp(createAgentAccessRateLimiter({limit: 1, now: () => 1_000}));
    const address = await app.listen({port: 0, host: '127.0.0.1'});
    const client = new Client({name: 'test-http-client', version: '0.0.0'});
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', address), {
      requestInit: {headers: {authorization: 'Bearer valid-token'}},
    });

    await client.connect(transport as unknown as Transport);
    await client.listTools();
    await client.callTool(
      {name: 'agent_access_fixture', arguments: {message: 'first'}},
      CallToolResultSchema,
    );
    const overLimit = await client.callTool(
      {name: 'agent_access_fixture', arguments: {message: 'second'}},
      CallToolResultSchema,
    );
    await client.close();

    expect(overLimit.isError).toBe(true);
    expect(overLimit.structuredContent).toEqual({
      ok: false,
      error: {code: 'rate-limited', retry_after_seconds: 60},
    });
  });
});

async function createTestApp(
  rateLimiter = createAgentAccessRateLimiter(),
  routeOptions: Omit<
    CreateAgentAccessRoutesOptions,
    'apiPublicUrl' | 'isOriginAllowed' | 'rateLimiter'
  > = {},
) {
  const app = await createApp({
    auth: [testAuth],
    routes: [
      createAgentAccessRoutes({
        apiPublicUrl: 'https://api.example.test/',
        isOriginAllowed: (origin) =>
          origin === undefined || origin === 'https://allowed.example.test',
        rateLimiter,
        ...routeOptions,
      }),
    ],
    swagger: false,
  });
  await app.ready();
  return app;
}
