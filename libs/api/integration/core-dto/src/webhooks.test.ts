import {
  createStoredWebhookRequest,
  decodeWebhookBody,
  storedWebhookRequestSchema,
  WEBHOOK_MAX_RAW_BODY_BYTES,
  WEBHOOK_MAX_RAW_QUERY_STRING_LENGTH,
  WEBHOOK_MAX_SERIALIZED_REQUEST_BYTES,
  webhookProcessingResultSchema,
} from './webhooks.js';

const requestId = '9b11d65a-f7e7-40ea-b421-06af012a9be5';
const receivedAt = '2026-07-20T10:30:00.123Z';

function createMaximumSizeStoredWebhookRequestFixture() {
  const headers = Object.fromEntries(
    Array.from({length: 8}, (_, index) => [
      `x-fixture-${index}`,
      'a'.repeat(index === 7 ? 8_000 : 8 * 1024),
    ]),
  );

  return createStoredWebhookRequest({
    requestId,
    routeId: 'webhook.connection',
    receivedAt,
    rawQueryString: 'q='.padEnd(WEBHOOK_MAX_RAW_QUERY_STRING_LENGTH, 'q'),
    headers,
    body: new Uint8Array(WEBHOOK_MAX_RAW_BODY_BYTES),
    connectionId: 'c0a8012e-0b6d-4d8f-8d5c-6d74102602b0',
  });
}

describe('storedWebhookRequestSchema', () => {
  it('round-trips exact body bytes from a direct adapter through the stored contract', () => {
    const body = new Uint8Array([0, 255, 5, 128, 42]);
    const directRequest = createStoredWebhookRequest({
      requestId,
      routeId: 'slack.command',
      receivedAt,
      rawQueryString: '',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body,
    });

    const queuedRequest = storedWebhookRequestSchema.parse(
      JSON.parse(JSON.stringify(directRequest)),
    );

    expect(queuedRequest.received_at).toBe(receivedAt);
    expect(decodeWebhookBody(queuedRequest.body)).toEqual(body);
  });

  it('rejects unknown fields, routes, and schema versions', () => {
    const request = createStoredWebhookRequest({
      requestId,
      routeId: 'github',
      receivedAt,
      rawQueryString: '',
      headers: {'content-type': 'application/json'},
      body: new Uint8Array(),
    });

    expect(storedWebhookRequestSchema.safeParse({...request, added_later: true}).success).toBe(
      false,
    );
    expect(storedWebhookRequestSchema.safeParse({...request, schema_version: 2}).success).toBe(
      false,
    );
    expect(storedWebhookRequestSchema.safeParse({...request, route_id: 'stripe'}).success).toBe(
      false,
    );
  });

  it('requires a generic connection identifier only for the generic route', () => {
    const genericRequest = createStoredWebhookRequest({
      requestId,
      routeId: 'webhook.connection',
      receivedAt,
      rawQueryString: '',
      headers: {'content-type': 'application/json'},
      body: new Uint8Array(),
      connectionId: 'c0a8012e-0b6d-4d8f-8d5c-6d74102602b0',
    });

    const withoutConnectionId = {
      ...genericRequest,
      path_parameters: {},
    };

    expect(storedWebhookRequestSchema.safeParse(withoutConnectionId).success).toBe(false);
  });

  it('requires and round-trips a connection identifier for Jira requests', () => {
    const request = createStoredWebhookRequest({
      requestId,
      routeId: 'jira',
      receivedAt,
      rawQueryString: '',
      headers: {authorization: 'Bearer token'},
      body: new Uint8Array([1, 2, 3]),
      connectionId: 'c0a8012e-0b6d-4d8f-8d5c-6d74102602b0',
    });

    expect(request.path_parameters.connection_id).toBe('c0a8012e-0b6d-4d8f-8d5c-6d74102602b0');
    expect(storedWebhookRequestSchema.parse(JSON.parse(JSON.stringify(request)))).toEqual(request);
    expect(storedWebhookRequestSchema.safeParse({...request, path_parameters: {}}).success).toBe(
      false,
    );
  });

  it('keeps the maximum-size fixture below the SQS message limit', () => {
    const fixture = createMaximumSizeStoredWebhookRequestFixture();
    const serializedSize = new TextEncoder().encode(JSON.stringify(fixture)).byteLength;

    expect(decodeWebhookBody(fixture.body)).toHaveLength(WEBHOOK_MAX_RAW_BODY_BYTES);
    expect(serializedSize).toBeLessThan(WEBHOOK_MAX_SERIALIZED_REQUEST_BYTES);
  });
});

describe('webhookProcessingResultSchema', () => {
  it.each([
    {outcome: 'processed'},
    {outcome: 'processed', challenge: 'slack-url-verification'},
    {outcome: 'duplicate', deliveryId: 'delivery-1'},
    {outcome: 'discarded', reason: 'invalid_signature'},
  ])('accepts the %s processing outcome', (result) => {
    expect(webhookProcessingResultSchema.safeParse(result).success).toBe(true);
  });
});
