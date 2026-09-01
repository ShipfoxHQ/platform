import {createHmac, randomUUID} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {WEBHOOK_MAX_RAW_BODY_BYTES} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import {db} from '#db/db.js';
import {upsertLinearInstallation} from '#db/installations.js';
import {linearInstallations} from '#db/schema/installations.js';
import {createLinearWebhookRoutes} from './webhooks.js';

const WEBHOOK_SECRET = 'test-webhook-secret';

function fakeConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    provider: 'linear',
    externalAccountId: 'org-1',
    slug: 'Linear_Acme',
    displayName: 'Linear Acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    repositoryAccessMode: overrides.repositoryAccessMode ?? 'selected',
  };
}

function linearPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'create',
    type: 'Issue',
    organizationId: `org-${randomUUID()}`,
    webhookTimestamp: Date.now(),
    data: {id: 'issue-1'},
    ...overrides,
  };
}

function agentSessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'created',
    type: 'AgentSessionEvent',
    organizationId: `org-${randomUUID()}`,
    appUserId: 'app-user-1',
    webhookTimestamp: Date.now(),
    agentSession: {id: 'session-1'},
    ...overrides,
  };
}

function signedHeaders(rawBody: string, event: string, deliveryId: string) {
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  return {
    'content-type': 'application/json',
    'linear-delivery': deliveryId,
    'linear-event': event,
    'linear-signature': signature,
  };
}

interface TestApp {
  app: FastifyInstance;
  publishIntegrationEventReceived: ReturnType<typeof vi.fn>;
  recordDeliveryOnly: ReturnType<typeof vi.fn>;
  getIntegrationConnectionById: ReturnType<typeof vi.fn>;
}

async function createTestApp(
  options: {connection?: IntegrationConnection | undefined} = {},
): Promise<TestApp> {
  const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
  const recordDeliveryOnly = vi.fn(() => Promise.resolve());
  const getIntegrationConnectionById = vi.fn(() =>
    Promise.resolve(options.connection ?? fakeConnection()),
  );
  const routes = createLinearWebhookRoutes({
    coreDb: db,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
    getIntegrationConnectionById,
  });
  const app = await createApp({routes: [routes], swagger: false});
  await app.ready();
  return {app, publishIntegrationEventReceived, recordDeliveryOnly, getIntegrationConnectionById};
}

async function seedInstallation(input: {
  connectionId: string;
  organizationId: string;
}): Promise<void> {
  await upsertLinearInstallation({
    connectionId: input.connectionId,
    organizationId: input.organizationId,
    organizationUrlKey: 'acme',
    appUserId: 'app-user-1',
    scopes: ['read', 'write'],
    status: 'installed',
  });
}

describe('Linear webhook route', () => {
  beforeEach(async () => {
    await closeApp();
    await db().delete(linearInstallations);
  });

  afterEach(async () => {
    await closeApp();
  });

  it('publishes a supported signed data webhook', async () => {
    const connection = fakeConnection();
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp({
      connection,
    });
    const deliveryId = randomUUID();
    const rawPayload = linearPayload({organizationId: 'org-active'});
    await seedInstallation({connectionId: connection.id, organizationId: 'org-active'});
    const body = JSON.stringify(rawPayload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/linear',
      headers: signedHeaders(body, 'Issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
    expect(publishIntegrationEventReceived.mock.calls[0]?.[0]).toMatchObject({
      event: {
        provider: 'linear',
        source: connection.slug,
        event: 'Issue.create',
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        connectionName: connection.displayName,
        deliveryId,
        payload: rawPayload,
      },
    });
  });

  it('uses the Linear-Delivery header as the delivery dedup key', async () => {
    const connection = fakeConnection();
    const {app, publishIntegrationEventReceived} = await createTestApp({connection});
    const rawPayload = linearPayload({organizationId: 'org-dedup'});
    await seedInstallation({connectionId: connection.id, organizationId: 'org-dedup'});
    const body = JSON.stringify(rawPayload);

    const first = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/linear',
      headers: signedHeaders(body, 'Issue', 'linear-delivery-a'),
      payload: body,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/linear',
      headers: signedHeaders(body, 'Issue', 'linear-delivery-b'),
      payload: body,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(
      publishIntegrationEventReceived.mock.calls.map(([call]) => call.event.deliveryId),
    ).toEqual(['linear-delivery-a', 'linear-delivery-b']);
  });

  it.each([
    ['an assignment', {agentSession: {id: 'session-1', issueId: 'issue-1'}}],
    [
      'a comment mention',
      {agentSession: {id: 'session-1', commentId: 'comment-1', sourceCommentId: 'comment-1'}},
    ],
  ])('publishes %s as agentSession.created', async (_context, details) => {
    const connection = fakeConnection();
    const {app, publishIntegrationEventReceived} = await createTestApp({connection});
    const deliveryId = randomUUID();
    const rawPayload = agentSessionPayload({
      organizationId: `org-${deliveryId}`,
      promptContext: '<issue identifier="ENG-879">Route the complete payload</issue>',
      ...details,
    });
    await seedInstallation({connectionId: connection.id, organizationId: `org-${deliveryId}`});
    const body = JSON.stringify(rawPayload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/linear',
      headers: signedHeaders(body, 'AgentSessionEvent', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(publishIntegrationEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({event: 'agentSession.created', payload: rawPayload}),
      }),
    );
  });

  it('publishes prompted AgentSessionEvent deliveries without an agent response', async () => {
    const connection = fakeConnection();
    const {app, publishIntegrationEventReceived} = await createTestApp({connection});
    const deliveryId = randomUUID();
    const rawPayload = agentSessionPayload({
      action: 'prompted',
      organizationId: `org-${deliveryId}`,
      agentSession: {id: 'session-1', issueId: 'issue-1'},
    });
    await seedInstallation({connectionId: connection.id, organizationId: `org-${deliveryId}`});
    const body = JSON.stringify(rawPayload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/linear',
      headers: signedHeaders(body, 'AgentSessionEvent', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(publishIntegrationEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({event: expect.objectContaining({event: 'agentSession.prompted'})}),
    );
  });

  it.each([
    ['linear-delivery', 'missing Linear-Delivery header'],
    ['linear-event', 'missing Linear-Event header'],
    ['linear-signature', 'missing Linear-Signature header'],
  ])('rejects requests missing the %s header', async (headerName, error) => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const body = JSON.stringify(linearPayload());
    const headers = signedHeaders(body, 'Issue', randomUUID());
    delete headers[headerName as keyof typeof headers];

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/linear',
      headers,
      payload: body,
    });

    expect(res.statusCode).toBe(headerName === 'linear-signature' ? 401 : 400);
    expect(res.json()).toEqual({error});
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature before publishing or recording', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const body = JSON.stringify(linearPayload());
    const headers = signedHeaders(body, 'Issue', randomUUID());
    headers['linear-signature'] = 'bad-signature';

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/linear',
      headers,
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('rejects a body too large for the shared webhook request before processing it', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const body = 'a'.repeat(WEBHOOK_MAX_RAW_BODY_BYTES + 1);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/linear',
      headers: signedHeaders(body, 'Issue', randomUUID()),
      payload: body,
    });

    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({code: 'body-too-large'});
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('rejects invalid stored request metadata before processing it', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const body = JSON.stringify(linearPayload());
    const headers = signedHeaders(body, 'Issue', randomUUID());
    headers['linear-event'] = 'a'.repeat(8 * 1024 + 1);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/linear',
      headers,
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({code: 'invalid-webhook-request'});
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON after signature verification', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const body = '{"type":';

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/linear',
      headers: signedHeaders(body, 'Issue', randomUUID()),
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('records and drops signed JSON that does not match the base webhook envelope', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({
      action: 'create',
      type: 'AppUserNotification',
      organizationId: 'org-notification',
      webhookTimestamp: Date.now(),
      notification: {id: 'notification-1'},
    });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/linear',
      headers: signedHeaders(body, 'AppUserNotification', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledWith(
      expect.objectContaining({provider: 'linear', deliveryId}),
    );
  });

  it('rejects stale webhook timestamps before publishing or recording', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const body = JSON.stringify(linearPayload({webhookTimestamp: Date.now() - 61_000}));

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/linear',
      headers: signedHeaders(body, 'Issue', randomUUID()),
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('rejects future webhook timestamps before publishing or recording', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const body = JSON.stringify(linearPayload({webhookTimestamp: Date.now() + 61_000}));

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/linear',
      headers: signedHeaders(body, 'Issue', randomUUID()),
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('records and drops when the Linear-Event header disagrees with the signed payload type', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(linearPayload({type: 'Issue'}));

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/linear',
      headers: signedHeaders(body, 'Comment', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledWith(
      expect.objectContaining({provider: 'linear', deliveryId}),
    );
  });

  it('records and drops a signed webhook for an unknown organization', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(linearPayload({organizationId: 'org-missing'}));

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/linear',
      headers: signedHeaders(body, 'Issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledWith(
      expect.objectContaining({provider: 'linear', deliveryId}),
    );
  });

  it('records and drops signed unsupported resource events', async () => {
    const connection = fakeConnection();
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp({
      connection,
    });
    const deliveryId = randomUUID();
    await seedInstallation({connectionId: connection.id, organizationId: 'org-reaction'});
    const body = JSON.stringify(linearPayload({organizationId: 'org-reaction', type: 'Reaction'}));

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/linear',
      headers: signedHeaders(body, 'Reaction', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledWith(
      expect.objectContaining({provider: 'linear', deliveryId}),
    );
  });
});
