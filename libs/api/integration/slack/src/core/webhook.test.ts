import {randomUUID} from 'node:crypto';
import type {
  GetIntegrationConnectionByIdFn,
  IntegrationConnection,
} from '@shipfox/api-integration-spi';
import {db} from '#db/db.js';
import {getSlackInstallationByTeamId, upsertSlackInstallation} from '#db/installations.js';
import {slackInstallations} from '#db/schema/installations.js';
import {handleSlackCommand, handleSlackEvent} from './webhook.js';

function fakeConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
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
    ...overrides,
    repositoryAccessMode: overrides.repositoryAccessMode ?? 'selected',
  };
}

function eventEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    type: 'event_callback' as const,
    team_id: 'T1',
    api_app_id: 'A1',
    event: {type: 'app_mention', channel: 'C1', user: 'U1', text: 'hello', ts: '1.0'},
    event_id: 'Ev1',
    event_time: Math.floor(Date.now() / 1000) + 60,
    ...overrides,
  };
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    token: 'shared-verification-token',
    command: '/deploy',
    team_id: 'T1',
    channel_id: 'C1',
    user_id: 'U1',
    response_url: 'https://hooks.slack.com/commands/1',
    trigger_id: '1337.42',
    text: '',
    ...overrides,
  };
}

async function seedInstallation(
  connection: IntegrationConnection,
  status: 'installed' | 'revoked' = 'installed',
) {
  await upsertSlackInstallation({
    connectionId: connection.id,
    teamId: 'T1',
    teamName: 'Acme',
    appId: 'A1',
    botUserId: 'UBOT',
    scopes: [],
    status,
  });
}

function handlers(connection = fakeConnection()) {
  return {
    connection,
    publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: true})),
    recordDeliveryOnly: vi.fn(() => Promise.resolve()),
    claimWebhookDelivery: vi.fn(() => Promise.resolve({claimed: true})),
    getIntegrationConnectionById: vi.fn<GetIntegrationConnectionByIdFn>(() =>
      Promise.resolve(connection),
    ),
  };
}

describe('Slack webhook handlers', () => {
  beforeEach(async () => {
    await db().delete(slackInstallations);
  });

  it('publishes a supported event with a flattened payload', async () => {
    const deps = handlers();
    await seedInstallation(deps.connection);

    const result = await handleSlackEvent({
      tx: db(),
      deliveryId: 'Ev1',
      envelope: eventEnvelope(),
      ...deps,
    });

    expect(result.outcome).toBe('published');
    expect(deps.publishIntegrationEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          event: 'app_mention',
          deliveryId: 'Ev1',
          payload: expect.objectContaining({
            type: 'app_mention',
            channel: 'C1',
            team_id: 'T1',
            event_id: 'Ev1',
          }),
        }),
      }),
    );
  });

  it('reports a duplicate for a repeated Slack event delivery id', async () => {
    const deps = handlers();
    deps.publishIntegrationEventReceived.mockResolvedValue({published: false});
    await seedInstallation(deps.connection);

    const result = await handleSlackEvent({
      tx: db(),
      deliveryId: 'Ev-replayed',
      envelope: eventEnvelope({event_id: 'Ev-replayed'}),
      ...deps,
    });

    expect(result.outcome).toBe('duplicate');
    expect(deps.publishIntegrationEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({event: expect.objectContaining({deliveryId: 'Ev-replayed'})}),
    );
  });

  it('revokes an installation when Slack uninstalls the app', async () => {
    const deps = handlers();
    await seedInstallation(deps.connection);

    const result = await handleSlackEvent({
      tx: db(),
      deliveryId: 'Ev-uninstalled',
      envelope: eventEnvelope({event: {type: 'app_uninstalled'}}),
      ...deps,
    });

    const installation = await getSlackInstallationByTeamId('T1');
    expect(result.outcome).toBe('revoked');
    expect(installation?.status).toBe('revoked');
    expect(deps.claimWebhookDelivery).toHaveBeenCalledTimes(1);
    expect(deps.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(deps.getIntegrationConnectionById).not.toHaveBeenCalled();
  });

  it('revokes an installation when its bot token is revoked', async () => {
    const deps = handlers();
    await seedInstallation(deps.connection);

    const result = await handleSlackEvent({
      tx: db(),
      deliveryId: 'Ev-bot-revoked',
      envelope: eventEnvelope({event: {type: 'tokens_revoked', tokens: {bot: ['UBOT']}}}),
      ...deps,
    });

    const installation = await getSlackInstallationByTeamId('T1');
    expect(result.outcome).toBe('revoked');
    expect(installation?.status).toBe('revoked');
  });

  it.each([
    ['an OAuth token is revoked', {oauth: ['UOAUTH']}],
    ['the revoked token set is missing', undefined],
    ['the revoked bot token set is empty', {bot: []}],
  ])('keeps an installation active when %s', async (_description, tokens) => {
    const deps = handlers();
    await seedInstallation(deps.connection);

    const result = await handleSlackEvent({
      tx: db(),
      deliveryId: 'Ev-oauth-revoked',
      envelope: eventEnvelope({event: {type: 'tokens_revoked', tokens}}),
      ...deps,
    });

    const installation = await getSlackInstallationByTeamId('T1');
    expect(result.outcome).toBe('unaffected-revocation');
    expect(installation?.status).toBe('installed');
    expect(deps.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(deps.claimWebhookDelivery).toHaveBeenCalledTimes(1);
  });

  it('records an unknown lifecycle-event team without resolving a connection', async () => {
    const deps = handlers();

    const result = await handleSlackEvent({
      tx: db(),
      deliveryId: 'Ev-uninstalled-missing',
      envelope: eventEnvelope({
        team_id: 'T-missing',
        event: {type: 'app_uninstalled'},
      }),
      ...deps,
    });

    expect(result.outcome).toBe('unknown-team');
    expect(deps.getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(deps.claimWebhookDelivery).toHaveBeenCalledTimes(1);
  });

  it('records an already revoked lifecycle-event installation without throwing', async () => {
    const deps = handlers();
    await seedInstallation(deps.connection, 'revoked');

    const result = await handleSlackEvent({
      tx: db(),
      deliveryId: 'Ev-uninstalled-replay',
      envelope: eventEnvelope({event: {type: 'app_uninstalled'}}),
      ...deps,
    });

    expect(result.outcome).toBe('revoked-installation');
    expect(deps.claimWebhookDelivery).toHaveBeenCalledTimes(1);
  });

  it('does not revoke an installation after a duplicate lifecycle delivery', async () => {
    const deps = handlers();
    deps.claimWebhookDelivery.mockResolvedValue({claimed: false});
    await seedInstallation(deps.connection);

    const result = await handleSlackEvent({
      tx: db(),
      deliveryId: 'Ev-uninstalled-duplicate',
      envelope: eventEnvelope({event: {type: 'app_uninstalled'}}),
      ...deps,
    });

    const installation = await getSlackInstallationByTeamId('T1');
    expect(result.outcome).toBe('duplicate');
    expect(installation?.status).toBe('installed');
    expect(deps.getIntegrationConnectionById).not.toHaveBeenCalled();
  });

  it('does not revoke a reconnected installation for a delayed lifecycle event', async () => {
    const deps = handlers();
    await seedInstallation(deps.connection);
    await seedInstallation(deps.connection);

    const result = await handleSlackEvent({
      tx: db(),
      deliveryId: 'Ev-uninstalled-stale',
      envelope: eventEnvelope({
        event: {type: 'app_uninstalled'},
        event_time: Math.floor(Date.now() / 1000) - 60,
      }),
      ...deps,
    });

    const installation = await getSlackInstallationByTeamId('T1');
    expect(result.outcome).toBe('stale-lifecycle-event');
    expect(installation?.status).toBe('installed');
  });

  it.each([
    ['a bot-authored event', {event: {type: 'message', bot_id: 'B1'}}],
    ['an event from this installation bot', {event: {type: 'reaction_added', user: 'UBOT'}}],
    [
      'a nested edited bot message',
      {event: {type: 'message', subtype: 'message_changed', message: {bot_id: 'B1'}}},
    ],
  ])('records and drops %s', async (_description, override) => {
    const deps = handlers();
    await seedInstallation(deps.connection);

    const result = await handleSlackEvent({
      tx: db(),
      deliveryId: randomUUID(),
      envelope: eventEnvelope(override),
      ...deps,
    });

    expect(result.outcome).toBe('self-message');
    expect(deps.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(deps.recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  it('records an unknown team without resolving a connection', async () => {
    const deps = handlers();

    const result = await handleSlackEvent({
      tx: db(),
      deliveryId: 'Ev-missing',
      envelope: eventEnvelope({team_id: 'T-missing'}),
      ...deps,
    });

    expect(result.outcome).toBe('unknown-team');
    expect(deps.getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(deps.recordDeliveryOnly).toHaveBeenCalledWith(
      expect.objectContaining({provider: 'slack', deliveryId: 'Ev-missing'}),
    );
  });

  it('records an inactive connection', async () => {
    const deps = handlers(fakeConnection({lifecycleStatus: 'disabled'}));
    await seedInstallation(deps.connection);

    const result = await handleSlackEvent({
      tx: db(),
      deliveryId: 'Ev-disabled',
      envelope: eventEnvelope(),
      ...deps,
    });

    expect(result.outcome).toBe('inactive-connection');
    expect(deps.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(deps.recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  it('records a revoked installation without resolving a connection', async () => {
    const deps = handlers();
    await seedInstallation(deps.connection, 'revoked');

    const result = await handleSlackEvent({
      tx: db(),
      deliveryId: 'Ev-revoked',
      envelope: eventEnvelope(),
      ...deps,
    });

    expect(result.outcome).toBe('revoked-installation');
    expect(deps.getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(deps.recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  it('records an installation whose connection is missing', async () => {
    const deps = handlers();
    deps.getIntegrationConnectionById.mockResolvedValue(undefined);
    await seedInstallation(deps.connection);

    const result = await handleSlackEvent({
      tx: db(),
      deliveryId: 'Ev-missing-connection',
      envelope: eventEnvelope(),
      ...deps,
    });

    expect(result.outcome).toBe('missing-connection');
    expect(deps.recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  it('drops unsupported event types after resolving the installation', async () => {
    const deps = handlers();
    await seedInstallation(deps.connection);

    const result = await handleSlackEvent({
      tx: db(),
      deliveryId: 'Ev-unsupported',
      envelope: eventEnvelope({event: {type: 'channel_created'}}),
      ...deps,
    });

    expect(result.outcome).toBe('unsupported-event');
    expect(deps.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(deps.recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  it('publishes a command without its verification token', async () => {
    const deps = handlers();
    await seedInstallation(deps.connection);

    const result = await handleSlackCommand({
      tx: db(),
      deliveryId: '1337.42',
      command: command(),
      ...deps,
    });

    expect(result.outcome).toBe('published');
    expect(deps.publishIntegrationEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          event: 'slash_command',
          payload: expect.not.objectContaining({token: expect.anything()}),
        }),
      }),
    );
  });

  it('reports a duplicate slash command delivery', async () => {
    const deps = handlers();
    deps.publishIntegrationEventReceived.mockResolvedValue({published: false});
    await seedInstallation(deps.connection);

    const result = await handleSlackCommand({
      tx: db(),
      deliveryId: '1337.42',
      command: command(),
      ...deps,
    });

    expect(result.outcome).toBe('duplicate');
  });
});
