import {Buffer} from 'node:buffer';
import {WEBHOOK_MAX_RAW_BODY_BYTES} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import type {JiraWebhookProcessor} from '#core/webhook-processor.js';
import {createJiraWebhookRoutes} from './webhooks.js';

function createTestApp(processor: JiraWebhookProcessor): Promise<FastifyInstance> {
  return createApp({
    routes: [
      createJiraWebhookRoutes({
        coreDb: vi.fn() as never,
        publishIntegrationEventReceived: vi.fn() as never,
        recordDeliveryOnly: vi.fn() as never,
        getIntegrationConnectionById: vi.fn() as never,
        processor,
      }),
    ],
    swagger: false,
  });
}

describe('Jira webhook route', () => {
  afterEach(async () => {
    await closeApp();
  });

  it('stores the connection path and lower-case authorization header', async () => {
    const process = vi.fn().mockResolvedValue({outcome: 'processed', deliveryId: 'delivery-1'});
    const processor = {process: process as JiraWebhookProcessor['process']};
    const app = await createTestApp(processor);
    const connectionId = 'c0a8012e-0b6d-4d8f-8d5c-6d74102602b0';

    const response = await app.inject({
      method: 'POST',
      url: `/webhooks/integrations/jira/${connectionId}`,
      headers: {
        authorization: 'Bearer signed-token',
        'content-type': 'application/json',
        'x-atlassian-webhook-identifier': 'jira-delivery-1',
      },
      payload: '{}',
    });

    expect(response.statusCode).toBe(200);
    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({
        route_id: 'jira',
        path_parameters: {connection_id: connectionId},
        headers: {
          authorization: 'Bearer signed-token',
          'content-type': 'application/json',
          'x-atlassian-webhook-identifier': 'jira-delivery-1',
        },
      }),
    );
  });

  it('returns 401 for an authentication failure without recording a delivery', async () => {
    const process = vi.fn().mockResolvedValue({
      outcome: 'discarded',
      reason: 'invalid_signature',
      deliveryId: 'delivery-1',
    });
    const processor = {process: process as JiraWebhookProcessor['process']};
    const app = await createTestApp(processor);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/jira/c0a8012e-0b6d-4d8f-8d5c-6d74102602b0',
      headers: {'content-type': 'application/json'},
      payload: '{}',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({error: 'invalid authorization'});
  });

  it.each([
    ['a processed delivery', {outcome: 'processed', deliveryId: 'delivery-1'}],
    ['a duplicate delivery', {outcome: 'duplicate', deliveryId: 'delivery-1'}],
    ['a deliberate drop', {outcome: 'discarded', reason: 'connection_unavailable'}],
  ] as const)('returns 200 for %s', async (_description, result) => {
    const process = vi.fn().mockResolvedValue(result);
    const app = await createTestApp({process: process as JiraWebhookProcessor['process']});

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/jira/c0a8012e-0b6d-4d8f-8d5c-6d74102602b0',
      headers: {authorization: 'Bearer signed-token', 'content-type': 'application/json'},
      payload: '{}',
    });

    expect(response.statusCode).toBe(200);
    expect(process).toHaveBeenCalledOnce();
  });

  it('returns 400 for a malformed payload result', async () => {
    const process = vi.fn().mockResolvedValue({
      outcome: 'discarded',
      reason: 'malformed_payload',
      deliveryId: 'delivery-1',
    });
    const app = await createTestApp({process: process as JiraWebhookProcessor['process']});

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/jira/c0a8012e-0b6d-4d8f-8d5c-6d74102602b0',
      headers: {authorization: 'Bearer signed-token', 'content-type': 'application/json'},
      payload: '{}',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({error: 'malformed JSON'});
    expect(process).toHaveBeenCalledOnce();
  });

  it('returns 413 for oversized input without invoking the processor', async () => {
    const process = vi.fn();
    const app = await createTestApp({process: process as JiraWebhookProcessor['process']});

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/jira/c0a8012e-0b6d-4d8f-8d5c-6d74102602b0',
      headers: {authorization: 'Bearer signed-token', 'content-type': 'application/json'},
      payload: Buffer.alloc(WEBHOOK_MAX_RAW_BODY_BYTES + 1, 97),
    });

    expect(response.statusCode).toBe(413);
    expect(process).not.toHaveBeenCalled();
  });
});
