import {createHmac, randomUUID} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {createStoredWebhookRequest} from '@shipfox/api-integration-spi';
import {db} from '#db/db.js';
import {upsertSlackInstallation} from '#db/installations.js';
import {slackInstallations} from '#db/schema/installations.js';
import {createSlackWebhookProcessor} from './webhook-processor.js';

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
    repositoryAccessMode: 'selected',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function signedEventRequest(input: {
  receivedAt: string;
  timestamp?: number;
}): ReturnType<typeof createStoredWebhookRequest> {
  const body = Buffer.from(
    JSON.stringify({
      type: 'event_callback',
      team_id: 'T1',
      api_app_id: 'A1',
      event: {type: 'app_mention', channel: 'C1', user: 'U1', text: 'hello', ts: '1.0'},
      event_id: 'Ev-delayed',
      event_time: 1_721_300_000,
    }),
  );
  const timestamp = `${input.timestamp ?? Math.floor(new Date(input.receivedAt).getTime() / 1000)}`;
  const signature = `v0=${createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:`)
    .update(body)
    .digest('hex')}`;
  return createStoredWebhookRequest({
    requestId: randomUUID(),
    routeId: 'slack.event',
    receivedAt: input.receivedAt,
    rawQueryString: '',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature,
    },
    body,
  });
}

describe('Slack webhook processor', () => {
  beforeEach(async () => {
    await db().delete(slackInstallations);
  });

  it('accepts an event delayed after a valid receipt', async () => {
    const connection = fakeConnection();
    const receivedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    await upsertSlackInstallation({
      connectionId: connection.id,
      teamId: 'T1',
      teamName: 'Acme',
      appId: 'A1',
      botUserId: 'UBOT',
      scopes: [],
      status: 'installed',
    });
    const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
    const processor = createSlackWebhookProcessor({
      coreDb: db,
      claimWebhookDelivery: vi.fn(() => Promise.resolve({claimed: true})),
      publishIntegrationEventReceived,
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(connection)),
    });

    const result = await processor.process(signedEventRequest({receivedAt}));

    expect(result).toMatchObject({outcome: 'processed', deliveryId: 'Ev-delayed'});
    expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
  });

  it('discards an event stale at receipt', async () => {
    const receivedAt = new Date().toISOString();
    const processor = createSlackWebhookProcessor({
      coreDb: db,
      claimWebhookDelivery: vi.fn(() => Promise.resolve({claimed: true})),
      publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: true})),
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(),
    });

    const result = await processor.process(
      signedEventRequest({receivedAt, timestamp: Math.floor(Date.now() / 1000) - 301}),
    );

    expect(result).toMatchObject({outcome: 'discarded', reason: 'stale_at_receipt'});
  });
});
