import {createHmac} from 'node:crypto';
import type {JiraWebhookEnvelopeDto} from '@shipfox/api-integration-jira-dto';
import {createStoredWebhookRequest, type IntegrationConnection} from '@shipfox/api-integration-spi';
import {signHs256} from '@shipfox/node-jwt';
import {createJiraWebhookProcessor} from './webhook-processor.js';

const connectionId = 'c0a8012e-0b6d-4d8f-8d5c-6d74102602b0';
const cloudId = 'cloud-1';
const receivedAt = new Date().toISOString();

function createConnection(
  id = connectionId,
  externalAccountId = cloudId,
): IntegrationConnection<'jira'> {
  const now = new Date();
  return {
    id,
    workspaceId: 'a0a8012e-0b6d-4d8f-8d5c-6d74102602b0',
    provider: 'jira',
    externalAccountId,
    slug: 'jira_acme',
    displayName: 'Jira Acme',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: now,
    updatedAt: now,
  };
}

function createPayload(
  event: JiraWebhookEnvelopeDto['webhookEvent'] = 'jira:issue_created',
  accountId = 'account-2',
): JiraWebhookEnvelopeDto {
  return {
    webhookEvent: event,
    timestamp: Date.now(),
    issue_event_type_name: event.startsWith('jira:') ? event.slice('jira:'.length) : 'comment',
    issue: {
      id: '10001',
      key: 'ENG-1',
      fields: {summary: 'Webhook test', status: null, assignee: null},
    },
    user: {accountId},
    ...(event.startsWith('jira:')
      ? {changelog: {items: []}}
      : {
          comment: {
            id: '10002',
            author: {accountId: 'account-2'},
            body: {type: 'doc', version: 1, content: []},
          },
        }),
    matchedWebhookIds: [42],
  } as JiraWebhookEnvelopeDto;
}

function createRequest(
  payload: unknown,
  authorization = 'Bearer invalid',
  requestReceivedAt = receivedAt,
  requestConnectionId = connectionId,
  jiraWebhookIdentifier?: string,
) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  return createStoredWebhookRequest({
    requestId: crypto.randomUUID(),
    routeId: 'jira',
    receivedAt: requestReceivedAt,
    rawQueryString: '',
    headers: {
      authorization,
      'content-type': 'application/json',
      ...(jiraWebhookIdentifier ? {'x-atlassian-webhook-identifier': jiraWebhookIdentifier} : {}),
    },
    body,
    connectionId: requestConnectionId,
  });
}

async function signedAuthorization(expiresIn = '1h') {
  return await signHs256({
    payload: {iss: 'atlassian'},
    secret: 'test-client-secret',
    expiresIn,
  });
}

function createWrongAlgorithmToken(token: string): string {
  const header = Buffer.from(JSON.stringify({alg: 'HS384', typ: 'JWT'})).toString('base64url');
  const [, payload] = token.split('.');
  const signingInput = `${header}.${payload}`;
  const signature = createHmac('sha384', 'test-client-secret')
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

function createHarness(overrides: {published?: boolean; deduplicate?: boolean} = {}) {
  const seenDeliveryIds = new Set<string>();
  const publishIntegrationEventReceived = vi.fn().mockImplementation(({event}) => {
    if (overrides.deduplicate && seenDeliveryIds.has(event.deliveryId)) {
      return Promise.resolve({published: false});
    }
    seenDeliveryIds.add(event.deliveryId);
    return Promise.resolve({published: overrides.published ?? true});
  });
  const recordDeliveryOnly = vi.fn().mockResolvedValue(undefined);
  const coreDb = vi.fn(() => ({
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => await callback({}),
  }));
  const getIntegrationConnectionById = vi
    .fn()
    .mockImplementation(async (id: string) =>
      createConnection(id, id === connectionId ? cloudId : `cloud-${id}`),
    );
  const getJiraInstallationByConnectionId = vi.fn().mockImplementation(async (id: string) => ({
    connectionId: id,
    cloudId: id === connectionId ? cloudId : `cloud-${id}`,
    authorizingAccountId: 'account-1',
    webhookIds: [42],
    status: 'installed',
  }));
  const processor = createJiraWebhookProcessor({
    coreDb: coreDb as never,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
    getIntegrationConnectionById,
    getJiraInstallationByConnectionId,
  });
  return {
    processor,
    coreDb,
    getIntegrationConnectionById,
    getJiraInstallationByConnectionId,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
  };
}

describe('Jira webhook processor', () => {
  it('verifies, normalizes, and publishes a supported event', async () => {
    const harness = createHarness();
    const token = await signedAuthorization();
    const request = await createRequest(createPayload(), `Bearer ${token}`);

    const result = await harness.processor.process(request);

    expect(result).toMatchObject({outcome: 'processed'});
    expect(harness.publishIntegrationEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          provider: 'jira',
          event: 'jira:issue_created',
          connectionId,
          payload: expect.objectContaining({cloudId}),
        }),
      }),
    );
    expect(
      harness.publishIntegrationEventReceived.mock.calls[0]?.[0].event.payload,
    ).not.toHaveProperty('authorization');
  });

  it('rejects missing or tampered authorization without recording a delivery', async () => {
    const harness = createHarness();
    const payload = createPayload();
    const missing = await harness.processor.process(await createRequest(payload, ''));
    const tamperedToken = `${await signedAuthorization()}tampered`;
    const tampered = await harness.processor.process(
      await createRequest(payload, `Bearer ${tamperedToken}`),
    );

    expect(missing).toMatchObject({outcome: 'discarded', reason: 'invalid_signature'});
    expect(tampered).toMatchObject({outcome: 'discarded', reason: 'invalid_signature'});
    expect(harness.recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('rejects tokens that are expired at Jira receipt time or use another algorithm', async () => {
    const receiptTime = new Date('2030-01-01T00:00:00.000Z');
    vi.useFakeTimers({now: new Date(receiptTime.getTime() - 120_000)});
    try {
      const expiredToken = await signedAuthorization('60s');
      const validToken = await signedAuthorization();
      const harness = createHarness();

      const expired = await harness.processor.process(
        createRequest(createPayload(), `Bearer ${expiredToken}`, receiptTime.toISOString()),
      );
      const wrongAlgorithm = await harness.processor.process(
        createRequest(
          createPayload(),
          `Bearer ${createWrongAlgorithmToken(validToken)}`,
          receiptTime.toISOString(),
        ),
      );

      expect(expired).toMatchObject({outcome: 'discarded', reason: 'invalid_signature'});
      expect(wrongAlgorithm).toMatchObject({outcome: 'discarded', reason: 'invalid_signature'});
      expect(harness.recordDeliveryOnly).not.toHaveBeenCalled();
      expect(harness.publishIntegrationEventReceived).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('records authenticated deliberate drops for mismatched and self-authored deliveries', async () => {
    const harness = createHarness();
    const token = await signedAuthorization();
    const mismatch = await createRequest(
      {...createPayload(), matchedWebhookIds: [99]},
      `Bearer ${token}`,
    );
    const selfAuthored = await createRequest(
      createPayload('comment_created', 'account-1'),
      `Bearer ${token}`,
    );

    const mismatchResult = await harness.processor.process(mismatch);
    const selfAuthoredResult = await harness.processor.process(selfAuthored);

    expect(mismatchResult).toMatchObject({outcome: 'discarded', reason: 'connection_unavailable'});
    expect(selfAuthoredResult).toMatchObject({outcome: 'discarded', reason: 'unsupported_event'});
    expect(harness.recordDeliveryOnly).toHaveBeenCalledTimes(2);
    expect(harness.publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it.each([
    'comment_updated',
    'jira:issue_updated',
  ] as const)('drops self-authored %s events without publishing', async (event) => {
    const harness = createHarness();
    const token = await signedAuthorization();

    const result = await harness.processor.process(
      createRequest(createPayload(event, 'account-1'), `Bearer ${token}`),
    );

    expect(result).toMatchObject({outcome: 'discarded', reason: 'unsupported_event'});
    expect(harness.recordDeliveryOnly).toHaveBeenCalledOnce();
    expect(harness.publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it('publishes a self-authored comment_deleted event', async () => {
    const harness = createHarness();
    const token = await signedAuthorization();

    const result = await harness.processor.process(
      createRequest(createPayload('comment_deleted', 'account-1'), `Bearer ${token}`),
    );

    expect(result).toMatchObject({outcome: 'processed'});
    expect(harness.publishIntegrationEventReceived).toHaveBeenCalledOnce();
  });

  it('records unsupported events and rejects missing, wrong-provider, inactive, and revoked connections', async () => {
    const token = await signedAuthorization();
    const unsupported = createHarness();
    const unsupportedResult = await unsupported.processor.process(
      createRequest({...createPayload(), webhookEvent: 'jira:unknown'}, `Bearer ${token}`),
    );
    expect(unsupportedResult).toMatchObject({outcome: 'discarded', reason: 'unsupported_event'});
    expect(unsupported.recordDeliveryOnly).toHaveBeenCalledOnce();

    const missing = createHarness();
    missing.getIntegrationConnectionById.mockResolvedValue(undefined);
    const missingResult = await missing.processor.process(
      createRequest(createPayload(), `Bearer ${token}`),
    );

    const missingInstallation = createHarness();
    missingInstallation.getJiraInstallationByConnectionId.mockResolvedValue(undefined);
    const missingInstallationResult = await missingInstallation.processor.process(
      createRequest(createPayload(), `Bearer ${token}`),
    );

    const wrongProvider = createHarness();
    wrongProvider.getIntegrationConnectionById.mockResolvedValue({
      ...createConnection(),
      provider: 'github',
    });
    const wrongProviderResult = await wrongProvider.processor.process(
      createRequest(createPayload(), `Bearer ${token}`),
    );

    const inactive = createHarness();
    inactive.getIntegrationConnectionById.mockResolvedValue({
      ...createConnection(),
      lifecycleStatus: 'error',
    });
    const inactiveResult = await inactive.processor.process(
      createRequest(createPayload(), `Bearer ${token}`),
    );

    const revoked = createHarness();
    revoked.getJiraInstallationByConnectionId.mockResolvedValue({
      connectionId,
      cloudId,
      authorizingAccountId: 'account-1',
      webhookIds: [42],
      status: 'revoked',
    });
    const revokedResult = await revoked.processor.process(
      createRequest(createPayload(), `Bearer ${token}`),
    );

    for (const result of [
      missingResult,
      missingInstallationResult,
      wrongProviderResult,
      inactiveResult,
      revokedResult,
    ]) {
      expect(result).toMatchObject({outcome: 'discarded', reason: 'connection_unavailable'});
    }
    for (const harness of [missing, missingInstallation, wrongProvider, inactive, revoked]) {
      expect(harness.recordDeliveryOnly).toHaveBeenCalledOnce();
      expect(harness.publishIntegrationEventReceived).not.toHaveBeenCalled();
    }
  });

  it('returns duplicate for a repeated body hash without publishing twice', async () => {
    const harness = createHarness({published: false});
    const token = await signedAuthorization();
    const request = await createRequest(createPayload(), `Bearer ${token}`);

    const result = await harness.processor.process(request);

    expect(result).toMatchObject({outcome: 'duplicate'});
    expect(harness.publishIntegrationEventReceived).toHaveBeenCalledOnce();
  });

  it('uses Jira’s stable delivery identifier when it is present', async () => {
    const harness = createHarness({deduplicate: true});
    const token = await signedAuthorization();
    const firstPayload = createPayload();
    const replayPayload = {...firstPayload, timestamp: firstPayload.timestamp + 1};

    const first = await harness.processor.process(
      createRequest(firstPayload, `Bearer ${token}`, receivedAt, connectionId, 'jira-delivery-1'),
    );
    const replay = await harness.processor.process(
      createRequest(replayPayload, `Bearer ${token}`, receivedAt, connectionId, 'jira-delivery-1'),
    );

    expect(first).toMatchObject({
      outcome: 'processed',
      deliveryId: `${connectionId}:jira-delivery-1`,
    });
    expect(replay).toMatchObject({
      outcome: 'duplicate',
      deliveryId: `${connectionId}:jira-delivery-1`,
    });
    expect(harness.publishIntegrationEventReceived).toHaveBeenCalledTimes(2);
  });

  it('scopes delivery deduplication by connection and still rejects a replay on that connection', async () => {
    const harness = createHarness({deduplicate: true});
    const token = await signedAuthorization();
    const otherConnectionId = crypto.randomUUID();
    const payload = createPayload();

    const first = await harness.processor.process(createRequest(payload, `Bearer ${token}`));
    const replay = await harness.processor.process(createRequest(payload, `Bearer ${token}`));
    const otherConnection = await harness.processor.process(
      createRequest(payload, `Bearer ${token}`, receivedAt, otherConnectionId),
    );

    expect(first).toMatchObject({outcome: 'processed'});
    expect(replay).toMatchObject({outcome: 'duplicate'});
    expect(otherConnection).toMatchObject({outcome: 'processed'});
    const events = harness.publishIntegrationEventReceived.mock.calls.map(([input]) => input.event);
    expect(events).toHaveLength(3);
    expect(events[0]?.deliveryId).not.toBe(events[2]?.deliveryId);
    expect(events[0]?.connectionId).toBe(connectionId);
    expect(events[2]?.connectionId).toBe(otherConnectionId);
  });

  it('accepts a JWT that was valid when Jira delivered the request', async () => {
    const receiptTime = new Date('2030-01-01T00:00:00.000Z');
    vi.useFakeTimers({now: receiptTime});
    try {
      const token = await signHs256({
        payload: {iss: 'atlassian'},
        secret: 'test-client-secret',
        expiresIn: '60s',
      });
      vi.setSystemTime(new Date(receiptTime.getTime() + 120_000));

      const harness = createHarness();
      const result = await harness.processor.process(
        createRequest(createPayload(), `Bearer ${token}`, receiptTime.toISOString()),
      );

      expect(result).toMatchObject({outcome: 'processed'});
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns malformed payload after authenticating before parsing succeeds', async () => {
    const harness = createHarness();
    const token = await signedAuthorization();
    const request = createStoredWebhookRequest({
      requestId: crypto.randomUUID(),
      routeId: 'jira',
      receivedAt,
      rawQueryString: '',
      headers: {authorization: `Bearer ${token}`},
      body: new TextEncoder().encode('{'),
      connectionId,
    });

    await expect(harness.processor.process(request)).resolves.toMatchObject({
      outcome: 'discarded',
      reason: 'malformed_payload',
    });
    expect(harness.recordDeliveryOnly).not.toHaveBeenCalled();
  });
});
