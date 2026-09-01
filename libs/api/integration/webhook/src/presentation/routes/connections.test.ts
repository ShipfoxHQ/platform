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
import {WEBHOOK_RESERVED_SLUGS, webhookEventCatalog} from '@shipfox/api-integration-webhook-dto';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import type {CreateWebhookIntegrationProviderOptions} from '#index.js';
import {createWebhookIntegrationProvider} from '#index.js';

type CreateConnectionFn = CreateWebhookIntegrationProviderOptions['createIntegrationConnection'];
type ListConnectionsFn = CreateWebhookIntegrationProviderOptions['listIntegrationConnections'];
type GetConnectionFn = CreateWebhookIntegrationProviderOptions['getIntegrationConnectionById'];
type UpdateConnectionFn =
  CreateWebhookIntegrationProviderOptions['updateIntegrationConnectionLifecycleStatus'];
type DeleteConnectionFn = CreateWebhookIntegrationProviderOptions['deleteIntegrationConnection'];

const INBOUND_URL_RE = /^https:\/\/api\.example\.com\/webhook\//;

let authenticatedMemberships: UserContextMembership[] = [];

function authorizeWorkspace(workspaceId: string): void {
  authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
}

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

function duplicateSlugError(): Error {
  const error = new Error('duplicate connection');
  error.name = 'IntegrationConnectionAlreadyExistsError';
  return error;
}

function connectionSlugConflictError(): Error {
  return new ConnectionSlugConflictError(new Error('duplicate slug'));
}

function fakeConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provider: 'webhook',
    externalAccountId: 'stripe',
    slug: 'stripe',
    displayName: 'Stripe',
    lifecycleStatus: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
    repositoryAccessMode: overrides.repositoryAccessMode ?? 'selected',
  };
}

function createStore() {
  const byId = new Map<string, IntegrationConnection>();
  const bySlug = new Map<string, string>();
  const seed = (connection: IntegrationConnection) => {
    byId.set(connection.id, connection);
    bySlug.set(`${connection.workspaceId}:${connection.slug}`, connection.id);
    return connection;
  };

  return {
    seed,
    createIntegrationConnection: vi.fn<CreateConnectionFn>((input) => {
      const key = `${input.workspaceId}:${input.slug}`;
      if (bySlug.has(key)) throw duplicateSlugError();
      const connection = fakeConnection({
        workspaceId: input.workspaceId,
        provider: input.provider,
        externalAccountId: input.externalAccountId,
        slug: input.slug,
        displayName: input.displayName,
        lifecycleStatus: input.lifecycleStatus ?? 'active',
      });
      seed(connection);
      return Promise.resolve(connection);
    }),
    listIntegrationConnections: vi.fn<ListConnectionsFn>(({workspaceId}) =>
      Promise.resolve(
        [...byId.values()].filter((connection) => connection.workspaceId === workspaceId),
      ),
    ),
    getIntegrationConnectionById: vi.fn<GetConnectionFn>((id) => Promise.resolve(byId.get(id))),
    updateIntegrationConnectionLifecycleStatus: vi.fn<UpdateConnectionFn>(
      ({id, lifecycleStatus}) => {
        const connection = byId.get(id);
        if (!connection) return Promise.resolve(undefined);
        const updated = {...connection, lifecycleStatus, updatedAt: new Date()};
        byId.set(id, updated);
        return Promise.resolve(updated);
      },
    ),
    deleteIntegrationConnection: vi.fn<DeleteConnectionFn>(({id}) =>
      Promise.resolve(byId.delete(id)),
    ),
  };
}

async function createTestApp(store = createStore()): Promise<{
  app: FastifyInstance;
  store: ReturnType<typeof createStore>;
}> {
  const provider = createWebhookIntegrationProvider({
    baseUrl: 'https://api.example.com/',
    coreDb: () => ({transaction: (callback) => callback({})}),
    publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: true})),
    ...store,
  } satisfies CreateWebhookIntegrationProviderOptions);
  expect(provider.eventCatalog).toBe(webhookEventCatalog);
  const app = await createApp({
    auth: [fakeUserAuth],
    routes: provider.routes,
    swagger: false,
  });
  await app.ready();
  return {app, store};
}

describe('webhook connection routes', () => {
  beforeEach(async () => {
    authenticatedMemberships = [];
    await closeApp();
  });

  afterEach(async () => {
    await closeApp();
  });

  it('creates a webhook connection with its inbound URL', async () => {
    const workspaceId = crypto.randomUUID();
    authorizeWorkspace(workspaceId);
    const {app} = await createTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/webhook/connections',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId, name: 'Stripe', slug: 'stripe-prod'},
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      workspace_id: workspaceId,
      name: 'Stripe',
      slug: 'stripe-prod',
      lifecycle_status: 'active',
      inbound_url: expect.stringMatching(INBOUND_URL_RE),
    });
  });

  it('returns 409 for a duplicate slug in the workspace', async () => {
    const workspaceId = crypto.randomUUID();
    authorizeWorkspace(workspaceId);
    const {app} = await createTestApp();
    const payload = {workspace_id: workspaceId, name: 'Stripe', slug: 'stripe-prod'};

    const first = await app.inject({
      method: 'POST',
      url: '/integrations/webhook/connections',
      headers: {authorization: 'Bearer user'},
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/integrations/webhook/connections',
      headers: {authorization: 'Bearer user'},
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('slug-already-exists');
  });

  it('returns 409 when the core connection create reports a slug conflict', async () => {
    const workspaceId = crypto.randomUUID();
    authorizeWorkspace(workspaceId);
    const store = createStore();
    store.createIntegrationConnection.mockRejectedValueOnce(connectionSlugConflictError());
    const {app} = await createTestApp(store);

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/webhook/connections',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId, name: 'Stripe', slug: 'stripe-prod'},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('slug-already-exists');
  });

  it('lists only webhook connections for the workspace', async () => {
    const workspaceId = crypto.randomUUID();
    authorizeWorkspace(workspaceId);
    const store = createStore();
    const webhook = store.seed(fakeConnection({workspaceId, externalAccountId: 'stripe'}));
    store.seed(fakeConnection({workspaceId, provider: 'github', externalAccountId: 'gh'}));
    store.seed(fakeConnection({workspaceId: crypto.randomUUID(), externalAccountId: 'other'}));
    const {app} = await createTestApp(store);

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/webhook/connections?workspace_id=${workspaceId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().connections).toEqual([
      expect.objectContaining({id: webhook.id, slug: 'stripe'}),
    ]);
  });

  it('updates a webhook connection lifecycle status', async () => {
    const store = createStore();
    const connection = store.seed(fakeConnection());
    authorizeWorkspace(connection.workspaceId);
    const {app} = await createTestApp(store);

    const res = await app.inject({
      method: 'PATCH',
      url: `/integrations/webhook/connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
      payload: {lifecycle_status: 'disabled'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().lifecycle_status).toBe('disabled');
  });

  it.each([
    {description: 'missing connection', connectionId: crypto.randomUUID()},
    {
      description: 'non-webhook connection',
      connectionId: undefined,
      seed: (store: ReturnType<typeof createStore>) =>
        store.seed(fakeConnection({provider: 'github'})).id,
    },
  ])('returns 404 when patching a $description', async ({connectionId, seed}) => {
    const store = createStore();
    const id = seed ? seed(store) : connectionId;
    if (seed && id) {
      const connection = await store.getIntegrationConnectionById(id);
      if (connection) authorizeWorkspace(connection.workspaceId);
    }
    const {app} = await createTestApp(store);

    const res = await app.inject({
      method: 'PATCH',
      url: `/integrations/webhook/connections/${id}`,
      headers: {authorization: 'Bearer user'},
      payload: {lifecycle_status: 'disabled'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
    expect(store.updateIntegrationConnectionLifecycleStatus).not.toHaveBeenCalled();
  });

  it('returns 404 when a webhook connection disappears during patch', async () => {
    const store = createStore();
    const connection = store.seed(fakeConnection());
    authorizeWorkspace(connection.workspaceId);
    store.updateIntegrationConnectionLifecycleStatus.mockResolvedValueOnce(undefined);
    const {app} = await createTestApp(store);

    const res = await app.inject({
      method: 'PATCH',
      url: `/integrations/webhook/connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
      payload: {lifecycle_status: 'disabled'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  it('deletes a webhook connection', async () => {
    const store = createStore();
    const connection = store.seed(fakeConnection());
    authorizeWorkspace(connection.workspaceId);
    const {app} = await createTestApp(store);

    const res = await app.inject({
      method: 'DELETE',
      url: `/integrations/webhook/connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    expect(store.deleteIntegrationConnection).toHaveBeenCalledWith({id: connection.id});
  });

  it.each([
    {description: 'missing connection', connectionId: crypto.randomUUID()},
    {
      description: 'non-webhook connection',
      connectionId: undefined,
      seed: (store: ReturnType<typeof createStore>) =>
        store.seed(fakeConnection({provider: 'github'})).id,
    },
  ])('returns 404 when deleting a $description', async ({connectionId, seed}) => {
    const store = createStore();
    const id = seed ? seed(store) : connectionId;
    if (seed && id) {
      const connection = await store.getIntegrationConnectionById(id);
      if (connection) authorizeWorkspace(connection.workspaceId);
    }
    const {app} = await createTestApp(store);

    const res = await app.inject({
      method: 'DELETE',
      url: `/integrations/webhook/connections/${id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
    expect(store.deleteIntegrationConnection).not.toHaveBeenCalled();
  });

  it.each(WEBHOOK_RESERVED_SLUGS)('rejects reserved slug %s', async (slug) => {
    const workspaceId = crypto.randomUUID();
    authorizeWorkspace(workspaceId);
    const {app} = await createTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/webhook/connections',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId, name: 'Reserved', slug},
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects a malformed slug', async () => {
    const workspaceId = crypto.randomUUID();
    authorizeWorkspace(workspaceId);
    const {app} = await createTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/webhook/connections',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId, name: 'Malformed', slug: 'Stripe_Prod'},
    });

    expect(res.statusCode).toBe(400);
  });
});
