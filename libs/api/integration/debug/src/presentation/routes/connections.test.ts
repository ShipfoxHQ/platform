import {AUTH_USER, setUserContext} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {createDebugIntegrationProvider} from '#index.js';
import type {CreateDebugIntegrationRoutesOptions} from '#presentation/routes/connections.js';

vi.mock('@shipfox/api-workspaces', () => ({
  requireMembership: vi.fn(({workspaceId}) =>
    Promise.resolve({
      workspaceId,
      workspace: {
        id: workspaceId,
        name: 'Workspace',
        status: 'active',
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      userId: 'user-1',
    }),
  ),
}));

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    setUserContext(request, {userId: 'user-1', email: 'user@example.com'});
    return Promise.resolve();
  },
};

function createUpsertStub(): CreateDebugIntegrationRoutesOptions['upsertIntegrationConnection'] {
  const connections = new Map<
    string,
    Awaited<ReturnType<CreateDebugIntegrationRoutesOptions['upsertIntegrationConnection']>>
  >();
  return vi.fn((input) => {
    const key = `${input.workspaceId}:${input.provider}:${input.externalAccountId}`;
    const existing = connections.get(key);
    if (existing) return Promise.resolve(existing);

    const now = new Date();
    const connection = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      provider: input.provider,
      externalAccountId: input.externalAccountId,
      displayName: input.displayName,
      lifecycleStatus: input.lifecycleStatus,
      createdAt: now,
      updatedAt: now,
    };
    connections.set(key, connection);
    return Promise.resolve(connection);
  });
}

async function createTestApp(includeDebug: boolean): Promise<FastifyInstance> {
  const provider = createDebugIntegrationProvider({
    upsertIntegrationConnection: createUpsertStub(),
  });
  const app = await createApp({
    auth: [fakeUserAuth],
    routes: includeDebug ? provider.routes : [],
    swagger: false,
  });
  await app.ready();
  return app;
}

describe('debug integration routes', () => {
  let app: FastifyInstance;
  let workspaceId: string;

  beforeEach(async () => {
    await closeApp();
    workspaceId = crypto.randomUUID();
  });

  afterEach(async () => {
    await closeApp();
  });

  it('does not mount Debug routes when the provider is not registered', async () => {
    app = await createTestApp(false);

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/debug/connections',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId},
    });

    expect(res.statusCode).toBe(404);
  });

  it('creates and upserts a Debug integration connection', async () => {
    app = await createTestApp(true);
    const payload = {workspace_id: workspaceId};

    const first = await app.inject({
      method: 'POST',
      url: '/integrations/debug/connections',
      headers: {authorization: 'Bearer user'},
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/integrations/debug/connections',
      headers: {authorization: 'Bearer user'},
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().id).toBe(first.json().id);
    expect(first.json().provider).toBe('debug');
    expect(first.json().capabilities).toEqual(['source_control']);
  });

  it('creates a connection usable by the Debug source-control provider', async () => {
    const provider = createDebugIntegrationProvider({
      upsertIntegrationConnection: createUpsertStub(),
    });
    const result = await provider.adapters.source_control.listRepositories({
      connection: {},
      limit: 50,
    });

    expect(result.repositories[0]?.fullName).toBe('debug-owner/platform');
  });
});
