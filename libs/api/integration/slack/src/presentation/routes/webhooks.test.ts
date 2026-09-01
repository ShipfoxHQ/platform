import {createHmac, randomUUID} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {WEBHOOK_MAX_RAW_BODY_BYTES} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {db} from '#db/db.js';
import {getSlackInstallationByTeamId, upsertSlackInstallation} from '#db/installations.js';
import {slackInstallations} from '#db/schema/installations.js';
import {createSlackWebhookRoutes, SLASH_COMMAND_ACK} from './webhooks.js';

const signingSecret = 'test-signing-secret';

function fakeConnection(): IntegrationConnection {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    provider: 'slack',
    externalAccountId: 'T1',
    slug: 'slack_acme',
    displayName: 'Slack Acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    repositoryAccessMode: 'selected',
  };
}

function slackHeaders(
  rawBody: string,
  contentType: string,
  timestamp = `${Math.floor(Date.now() / 1000)}`,
) {
  const hex = createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex');
  return {
    'content-type': contentType,
    'x-slack-request-timestamp': timestamp,
    'x-slack-signature': `v0=${hex}`,
  };
}

async function createTestApp(connection = fakeConnection()): Promise<{
  app: Awaited<ReturnType<typeof createApp>>;
  connection: IntegrationConnection;
  publishIntegrationEventReceived: ReturnType<typeof vi.fn>;
  recordDeliveryOnly: ReturnType<typeof vi.fn>;
  getIntegrationConnectionById: ReturnType<typeof vi.fn>;
}> {
  const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
  const recordDeliveryOnly = vi.fn(() => Promise.resolve());
  const claimWebhookDelivery = vi.fn(() => Promise.resolve({claimed: true}));
  const getIntegrationConnectionById = vi.fn(() => Promise.resolve(connection));
  const app = await createApp({
    routes: createSlackWebhookRoutes({
      coreDb: db,
      claimWebhookDelivery,
      publishIntegrationEventReceived,
      recordDeliveryOnly,
      getIntegrationConnectionById,
    }),
    swagger: false,
  });
  await app.ready();
  return {
    app,
    connection,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
    getIntegrationConnectionById,
  };
}

async function seedInstallation(connection: IntegrationConnection): Promise<void> {
  await upsertSlackInstallation({
    connectionId: connection.id,
    teamId: 'T1',
    teamName: 'Acme',
    appId: 'A1',
    botUserId: 'UBOT',
    scopes: [],
    status: 'installed',
  });
}

describe('Slack webhook routes', () => {
  beforeEach(async () => {
    await closeApp();
    await db().delete(slackInstallations);
  });

  afterEach(async () => {
    await closeApp();
  });

  it('answers a signed URL verification before resolving an installation', async () => {
    const {app, getIntegrationConnectionById} = await createTestApp();
    const rawBody = JSON.stringify({
      type: 'url_verification',
      token: 'token',
      challenge: 'challenge',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/slack/events',
      headers: slackHeaders(rawBody, 'application/json'),
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({challenge: 'challenge'});
    expect(getIntegrationConnectionById).not.toHaveBeenCalled();
  });

  it('rejects an unsigned request before parsing its body', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/slack/events',
      headers: {'content-type': 'application/json'},
      payload: '{"type":',
    });

    expect(response.statusCode).toBe(401);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('rejects a stale signed event before parsing it', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const rawBody = JSON.stringify({
      type: 'url_verification',
      token: 'token',
      challenge: 'challenge',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/slack/events',
      headers: slackHeaders(rawBody, 'application/json', `${Math.floor(Date.now() / 1000) - 301}`),
      payload: rawBody,
    });

    expect(response.statusCode).toBe(401);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('rejects signed malformed event JSON', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const rawBody = '{"type":';

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/slack/events',
      headers: slackHeaders(rawBody, 'application/json'),
      payload: rawBody,
    });

    expect(response.statusCode).toBe(400);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('rejects a body too large for the shared webhook request before processing it', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const rawBody = 'a'.repeat(WEBHOOK_MAX_RAW_BODY_BYTES + 1);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/slack/events',
      headers: slackHeaders(rawBody, 'application/json'),
      payload: rawBody,
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({code: 'body-too-large'});
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('publishes a signed event delivery through the route transaction', async () => {
    const {app, connection, publishIntegrationEventReceived} = await createTestApp();
    await seedInstallation(connection);
    const rawBody = JSON.stringify({
      type: 'event_callback',
      team_id: 'T1',
      api_app_id: 'A1',
      event: {type: 'app_mention', channel: 'C1', user: 'U1', text: 'hello', ts: '1.0'},
      event_id: 'Ev-route',
      event_time: 1_721_300_000,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/slack/events',
      headers: slackHeaders(rawBody, 'application/json'),
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);
    expect(publishIntegrationEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({event: 'app_mention', deliveryId: 'Ev-route'}),
      }),
    );
  });

  it('revokes an installation after a signed app-uninstalled event', async () => {
    const {app, connection, publishIntegrationEventReceived} = await createTestApp();
    await seedInstallation(connection);
    const rawBody = JSON.stringify({
      type: 'event_callback',
      team_id: 'T1',
      api_app_id: 'A1',
      event: {type: 'app_uninstalled'},
      event_id: 'Ev-route-uninstalled',
      event_time: Math.floor(Date.now() / 1000) + 60,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/slack/events',
      headers: slackHeaders(rawBody, 'application/json'),
      payload: rawBody,
    });

    const installation = await getSlackInstallationByTeamId('T1');
    expect(response.statusCode).toBe(200);
    expect(installation?.status).toBe('revoked');
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it('returns the fixed acknowledgement for a signed command that cannot resolve a team', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const rawBody = new URLSearchParams({
      token: 'verification-token',
      command: '/deploy',
      team_id: 'T-missing',
      channel_id: 'C1',
      user_id: 'U1',
      response_url: 'https://hooks.slack.com/commands/1',
      trigger_id: '1337.42',
      text: '',
    }).toString();

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/slack/commands',
      headers: slackHeaders(rawBody, 'application/x-www-form-urlencoded'),
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(SLASH_COMMAND_ACK);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledWith(
      expect.objectContaining({provider: 'slack', deliveryId: '1337.42'}),
    );
  });

  it('returns the acknowledgement for a signed command that fails validation', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const rawBody = new URLSearchParams({team_id: 'T1'}).toString();

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/slack/commands',
      headers: slackHeaders(rawBody, 'application/x-www-form-urlencoded'),
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(SLASH_COMMAND_ACK);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('publishes a signed command without exposing its verification token', async () => {
    const {app, connection, publishIntegrationEventReceived} = await createTestApp();
    await seedInstallation(connection);
    const rawBody = new URLSearchParams({
      token: 'verification-token',
      command: '/deploy',
      team_id: 'T1',
      channel_id: 'C1',
      user_id: 'U1',
      response_url: 'https://hooks.slack.com/commands/1',
      trigger_id: '1337.43',
      text: 'production',
    }).toString();

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/slack/commands',
      headers: slackHeaders(rawBody, 'application/x-www-form-urlencoded'),
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);
    expect(publishIntegrationEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          event: 'slash_command',
          deliveryId: '1337.43',
          payload: expect.not.objectContaining({token: expect.anything()}),
        }),
      }),
    );
  });
});
