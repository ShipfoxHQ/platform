import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import {createWebhookInboundRoutes} from './inbound.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fakeConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provider: 'webhook',
    externalAccountId: 'stripe-prod',
    slug: 'stripe_prod',
    displayName: 'Stripe Production',
    lifecycleStatus: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
    repositoryAccessMode: overrides.repositoryAccessMode ?? 'selected',
  };
}

async function createTestApp(
  options: {connection?: IntegrationConnection | undefined} = {},
): Promise<{
  app: FastifyInstance;
  publishIntegrationEventReceived: ReturnType<typeof vi.fn>;
  getIntegrationConnectionById: ReturnType<typeof vi.fn>;
}> {
  const connection = options.connection ?? fakeConnection();
  const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
  const getIntegrationConnectionById = vi.fn((id: string) =>
    Promise.resolve(id === connection.id ? connection : undefined),
  );
  const routes = createWebhookInboundRoutes({
    coreDb: () => ({transaction: (callback) => callback({})}),
    getIntegrationConnectionById,
    publishIntegrationEventReceived,
  });
  const app = await createApp({routes: [routes], swagger: false});
  await app.ready();
  return {app, publishIntegrationEventReceived, getIntegrationConnectionById};
}

describe('webhook inbound route', () => {
  beforeEach(async () => {
    await closeApp();
  });

  afterEach(async () => {
    await closeApp();
  });

  it('publishes a JSON delivery envelope', async () => {
    const connection = fakeConnection();
    const {app, publishIntegrationEventReceived, getIntegrationConnectionById} =
      await createTestApp({
        connection,
      });

    const res = await app.inject({
      method: 'POST',
      url: `/webhook/${connection.id}?mode=test&tag=one&tag=two`,
      headers: {
        'content-type': 'application/json',
        'x-delivery-id': 'evt-1',
        authorization: 'Bearer secret',
      },
      payload: {ok: true},
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().delivery_id).toBe('evt-1');
    expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
    expect(publishIntegrationEventReceived.mock.calls[0]?.[0].event).toMatchObject({
      provider: 'webhook',
      source: 'stripe_prod',
      event: 'received',
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      connectionName: 'Stripe Production',
      deliveryId: 'evt-1',
      payload: {
        method: 'POST',
        query: {mode: 'test', tag: ['one', 'two']},
        body: {ok: true},
        headers: {
          'content-type': 'application/json',
          'x-delivery-id': 'evt-1',
          authorization: '[redacted]',
        },
      },
    });
    expect(getIntegrationConnectionById).toHaveBeenCalledTimes(1);
  });

  it('publishes a form delivery envelope', async () => {
    const connection = fakeConnection();
    const {app, publishIntegrationEventReceived} = await createTestApp({connection});

    const res = await app.inject({
      method: 'POST',
      url: `/webhook/${connection.id}`,
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      payload: 'status=paid&amount=1200',
    });

    expect(res.statusCode).toBe(202);
    expect(publishIntegrationEventReceived.mock.calls[0]?.[0].event.payload.body).toEqual({
      status: 'paid',
      amount: '1200',
    });
  });

  it('publishes a text delivery envelope', async () => {
    const connection = fakeConnection();
    const {app, publishIntegrationEventReceived} = await createTestApp({connection});

    const res = await app.inject({
      method: 'POST',
      url: `/webhook/${connection.id}`,
      headers: {'content-type': 'text/plain'},
      payload: 'hello',
    });

    expect(res.statusCode).toBe(202);
    expect(publishIntegrationEventReceived.mock.calls[0]?.[0].event.payload.body).toBe('hello');
  });

  it('rejects unsupported content types without publishing', async () => {
    const connection = fakeConnection();
    const {app, publishIntegrationEventReceived} = await createTestApp({connection});

    const res = await app.inject({
      method: 'POST',
      url: `/webhook/${connection.id}`,
      headers: {'content-type': 'application/xml'},
      payload: '<ok />',
    });

    expect(res.statusCode).toBe(415);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON without publishing', async () => {
    const connection = fakeConnection();
    const {app, publishIntegrationEventReceived} = await createTestApp({connection});

    const res = await app.inject({
      method: 'POST',
      url: `/webhook/${connection.id}`,
      headers: {'content-type': 'application/json'},
      payload: '{"ok":',
    });

    expect(res.statusCode).toBe(400);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it.each([
    {connection: undefined, description: 'unknown connection'},
    {connection: fakeConnection({lifecycleStatus: 'disabled'}), description: 'disabled connection'},
    {connection: fakeConnection({provider: 'github'}), description: 'wrong provider'},
  ])('returns 404 for $description without publishing', async ({connection}) => {
    const activeConnection = connection ?? fakeConnection();
    const {app, publishIntegrationEventReceived} = await createTestApp({connection});

    const res = await app.inject({
      method: 'POST',
      url: `/webhook/${activeConnection.id}`,
      headers: {'content-type': 'application/json'},
      payload: {ok: true},
    });

    expect(res.statusCode).toBe(404);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it('uses a random delivery ID when no header is present', async () => {
    const connection = fakeConnection();
    const {app, publishIntegrationEventReceived} = await createTestApp({connection});

    const res = await app.inject({
      method: 'POST',
      url: `/webhook/${connection.id}`,
      headers: {'content-type': 'application/json'},
      payload: {ok: true},
    });

    expect(res.statusCode).toBe(202);
    const deliveryId = publishIntegrationEventReceived.mock.calls[0]?.[0].event.deliveryId;
    expect(deliveryId).toMatch(UUID_RE);
    expect(res.json().delivery_id).toBe(deliveryId);
  });

  it('rejects an overlong delivery ID header without publishing', async () => {
    const connection = fakeConnection();
    const {app, publishIntegrationEventReceived} = await createTestApp({connection});

    const res = await app.inject({
      method: 'POST',
      url: `/webhook/${connection.id}`,
      headers: {
        'content-type': 'application/json',
        'x-delivery-id': 'x'.repeat(201),
      },
      payload: {ok: true},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('delivery-id-too-long');
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
  });
});
