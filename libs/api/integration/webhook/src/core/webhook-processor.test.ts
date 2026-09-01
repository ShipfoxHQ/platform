import {randomUUID} from 'node:crypto';
import {createStoredWebhookRequest, type IntegrationConnection} from '@shipfox/api-integration-spi';
import {createGenericWebhookProcessor} from './webhook-processor.js';

function fakeConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  const now = new Date();
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
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

function genericWebhookRequest(connectionId: string) {
  return createStoredWebhookRequest({
    requestId: randomUUID(),
    routeId: 'webhook.connection',
    receivedAt: '2026-07-20T10:30:00.123Z',
    rawQueryString: 'mode=test&tag=one&tag=two',
    headers: {
      'content-type': 'application/json',
      'x-delivery-id': 'delivery-1',
      authorization: '[redacted]',
    },
    body: new TextEncoder().encode('{"ok":true}'),
    connectionId,
  });
}

describe('GenericWebhookProcessor', () => {
  it.each([
    ['a missing connection', undefined],
    ['an inactive connection', fakeConnection({lifecycleStatus: 'disabled'})],
  ])('discards queued delivery for %s', async (_description, connection) => {
    const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
    const processor = createGenericWebhookProcessor({
      coreDb: () => ({transaction: (callback) => callback({})}),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(connection)),
      publishIntegrationEventReceived,
    });

    const result = await processor.process(genericWebhookRequest(randomUUID()));

    expect(result).toEqual({outcome: 'discarded', reason: 'connection_unavailable'});
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it('publishes the compatible generic event envelope', async () => {
    const connection = fakeConnection();
    const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
    const processor = createGenericWebhookProcessor({
      coreDb: () => ({transaction: (callback) => callback({})}),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(connection)),
      publishIntegrationEventReceived,
    });

    const result = await processor.process(genericWebhookRequest(connection.id));

    expect(result).toEqual({outcome: 'processed', deliveryId: 'delivery-1'});
    expect(publishIntegrationEventReceived).toHaveBeenCalledWith({
      tx: {},
      event: expect.objectContaining({
        deliveryId: 'delivery-1',
        payload: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-delivery-id': 'delivery-1',
            authorization: '[redacted]',
          },
          query: {mode: 'test', tag: ['one', 'two']},
          body: {ok: true},
        },
      }),
    });
  });
});
