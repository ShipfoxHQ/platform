import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import {
  ConnectionSlugConflictError,
  type IntegrationConnection,
} from '@shipfox/api-integration-spi';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import type {GiteaApiClient} from '#api/client.js';
import type {ConnectGiteaConnectionInput} from '#core/connect.js';
import {createGiteaIntegrationProvider} from '#index.js';

let authenticatedMemberships: UserContextMembership[] = [];

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    setUserContext(
      request,
      buildUserContext({
        userId: 'user-1',
        email: 'user@example.com',
        memberships: authenticatedMemberships,
      }),
    );
    return Promise.resolve();
  },
};

function giteaClient(overrides: Partial<GiteaApiClient> = {}): GiteaApiClient {
  return {
    listOrgRepositories: vi.fn(() => Promise.reject(new Error('not used'))),
    getRepository: vi.fn(() => Promise.reject(new Error('not used'))),
    resolveRef: vi.fn(() => Promise.reject(new Error('not used'))),
    listTree: vi.fn(() => Promise.reject(new Error('not used'))),
    fetchFileContent: vi.fn(() => Promise.reject(new Error('not used'))),
    organizationExists: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

interface CreateTestAppOptions {
  gitea?: GiteaApiClient;
  existingConnection?: IntegrationConnection<'gitea'> | undefined;
  connectGiteaConnection?:
    | ((input: ConnectGiteaConnectionInput) => Promise<IntegrationConnection<'gitea'>>)
    | undefined;
}

async function createTestApp(options: CreateTestAppOptions = {}): Promise<FastifyInstance> {
  const provider = createGiteaIntegrationProvider({
    gitea: options.gitea ?? giteaClient(),
    getExistingGiteaConnection: vi.fn(() => Promise.resolve(options.existingConnection)),
    connectGiteaConnection:
      options.connectGiteaConnection ??
      vi.fn((input: ConnectGiteaConnectionInput) => {
        const connection: IntegrationConnection<'gitea'> = {
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          provider: 'gitea',
          externalAccountId: input.org,
          slug: 'gitea_shipfox',
          displayName: input.displayName,
          lifecycleStatus: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        return Promise.resolve(connection);
      }),
    // Provider-level mounting includes webhook routes; these tests exercise only connections.
    coreDb: vi.fn() as never,
    publishSourcePush: vi.fn() as never,
    recordDeliveryOnly: vi.fn() as never,
    getIntegrationConnectionById: vi.fn() as never,
  });
  const app = await createApp({
    auth: [fakeUserAuth],
    routes: provider.routes,
    swagger: false,
  });
  await app.ready();
  return app;
}

describe('Gitea connection routes', () => {
  beforeEach(async () => {
    authenticatedMemberships = [];
    await closeApp();
  });

  afterEach(async () => {
    await closeApp();
  });

  it('requires auth to connect an org', async () => {
    const app = await createTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/gitea/connections',
      payload: {workspace_id: crypto.randomUUID(), org: 'shipfox'},
    });

    expect(res.statusCode).toBe(401);
  });

  it('connects an org and returns the connection DTO', async () => {
    const app = await createTestApp();
    const workspaceId = crypto.randomUUID();
    authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/gitea/connections',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId, org: 'shipfox'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().provider).toBe('gitea');
    expect(res.json().external_account_id).toBe('shipfox');
    expect(res.json().lifecycle_status).toBe('active');
    expect(res.json().external_url).toBe('https://gitea.example.com/shipfox');
  });

  it('returns 404 when the org does not exist', async () => {
    const app = await createTestApp({
      gitea: giteaClient({organizationExists: vi.fn(() => Promise.resolve(false))}),
    });
    const workspaceId = crypto.randomUUID();
    authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/gitea/connections',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId, org: 'ghost'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('gitea-organization-not-found');
  });

  it('returns 409 when the org is already linked to another workspace', async () => {
    const workspaceId = crypto.randomUUID();
    authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
    const app = await createTestApp({
      existingConnection: {
        id: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        provider: 'gitea',
        externalAccountId: 'shipfox',
        slug: 'gitea_shipfox',
        displayName: 'Gitea shipfox',
        lifecycleStatus: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/gitea/connections',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId, org: 'shipfox'},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('gitea-org-already-linked');
  });

  it('returns 409 when connection slug allocation conflicts repeatedly', async () => {
    const workspaceId = crypto.randomUUID();
    authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
    const app = await createTestApp({
      connectGiteaConnection: vi.fn(() =>
        Promise.reject(new ConnectionSlugConflictError(new Error('duplicate slug'))),
      ),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/gitea/connections',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId, org: 'shipfox'},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('slug-conflict');
  });
});
