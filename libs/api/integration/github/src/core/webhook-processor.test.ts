import {createHmac, randomUUID} from 'node:crypto';
import {
  createStoredWebhookRequest,
  decodeWebhookBody,
  type IntegrationConnection,
} from '@shipfox/api-integration-spi';
import {db} from '#db/db.js';
import {githubInstallations} from '#db/schema/installations.js';
import {githubInstallationFactory} from '#test/index.js';
import {createGithubWebhookProcessor} from './webhook-processor.js';

const WEBHOOK_SECRET = 'test-webhook-secret';

function fakeConnection(id: string): IntegrationConnection {
  return {
    id,
    workspaceId: randomUUID(),
    provider: 'github',
    externalAccountId: '123',
    slug: 'github_shipfox',
    displayName: 'GitHub shipfox',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function signedInstallationRequest(deliveryId: string, installationId: number) {
  const body = Buffer.from(JSON.stringify({action: 'deleted', installation: {id: installationId}}));
  return createStoredWebhookRequest({
    requestId: randomUUID(),
    routeId: 'github',
    receivedAt: new Date().toISOString(),
    rawQueryString: '',
    headers: {
      'x-github-delivery': deliveryId,
      'x-github-event': 'installation',
      'x-hub-signature-256': `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`,
    },
    body,
  });
}

function signedRequest(deliveryId: string, event: string, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload));
  return createStoredWebhookRequest({
    requestId: randomUUID(),
    routeId: 'github',
    receivedAt: new Date().toISOString(),
    rawQueryString: '',
    headers: {
      'x-github-delivery': deliveryId,
      'x-github-event': event,
      'x-hub-signature-256': `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`,
    },
    body,
  });
}

describe('GitHub webhook processor', () => {
  beforeEach(async () => {
    await db().delete(githubInstallations);
  });

  it('discards a stored request with an invalid signature before opening a transaction', async () => {
    const coreDb = vi.fn();
    const processor = createGithubWebhookProcessor({
      coreDb,
      publishIntegrationEventReceived: vi.fn(),
      publishSourceRepositoryUpdated: vi.fn(),
      publishSourcePush: vi.fn(),
      recordDeliveryOnly: vi.fn(),
      getIntegrationConnectionById: vi.fn(),
    });
    const request = createStoredWebhookRequest({
      requestId: randomUUID(),
      routeId: 'github',
      receivedAt: new Date().toISOString(),
      rawQueryString: '',
      headers: {
        'x-github-delivery': randomUUID(),
        'x-github-event': 'push',
        'x-hub-signature-256': 'sha256=not-a-valid-signature',
      },
      body: Buffer.from('{}'),
    });

    const result = await processor.process(request);

    expect(result).toMatchObject({outcome: 'discarded', reason: 'invalid_signature'});
    expect(coreDb).not.toHaveBeenCalled();
  });

  it('discards a stored request missing required provider headers', async () => {
    const processor = createGithubWebhookProcessor({
      coreDb: vi.fn(),
      publishIntegrationEventReceived: vi.fn(),
      publishSourceRepositoryUpdated: vi.fn(),
      publishSourcePush: vi.fn(),
      recordDeliveryOnly: vi.fn(),
      getIntegrationConnectionById: vi.fn(),
    });
    const request = createStoredWebhookRequest({
      requestId: randomUUID(),
      routeId: 'github',
      receivedAt: new Date().toISOString(),
      rawQueryString: '',
      headers: {},
      body: Buffer.from('{}'),
    });

    const result = await processor.process(request);

    expect(result).toEqual({outcome: 'discarded', reason: 'missing_required_input'});
  });

  it('preserves the signed raw body from a stored request before reporting malformed JSON', async () => {
    const rawBody = Buffer.from('{"message":"h\u00e9llo"');
    const request = createStoredWebhookRequest({
      requestId: randomUUID(),
      routeId: 'github',
      receivedAt: new Date().toISOString(),
      rawQueryString: '',
      headers: {
        'x-github-delivery': randomUUID(),
        'x-github-event': 'push',
        'x-hub-signature-256': `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`,
      },
      body: rawBody,
    });
    const processor = createGithubWebhookProcessor({
      coreDb: () =>
        ({transaction: (callback: (tx: unknown) => Promise<unknown>) => callback({})}) as never,
      publishIntegrationEventReceived: vi.fn(),
      publishSourceRepositoryUpdated: vi.fn(),
      publishSourcePush: vi.fn(),
      recordDeliveryOnly: vi.fn(),
      getIntegrationConnectionById: vi.fn(),
    });

    const result = await processor.process(request);

    expect(Buffer.from(decodeWebhookBody(request.body))).toEqual(rawBody);
    expect(result).toMatchObject({outcome: 'discarded', reason: 'malformed_payload'});
  });

  it('retries credential cleanup after the delivery transaction commits', async () => {
    const installationId = 8412;
    const connectionId = randomUUID();
    const connection = fakeConnection(connectionId);
    const deliveryId = randomUUID();
    await githubInstallationFactory.create({
      connectionId,
      installationId: String(installationId),
    });
    const publishIntegrationEventReceived = vi
      .fn()
      .mockResolvedValueOnce({published: true})
      .mockResolvedValueOnce({published: false});
    const deleteInstallationTokenSecret = vi
      .fn()
      .mockRejectedValueOnce(new Error('secret store unavailable'))
      .mockResolvedValueOnce(1);
    const processor = createGithubWebhookProcessor({
      coreDb: db,
      publishIntegrationEventReceived,
      publishSourceRepositoryUpdated: vi.fn(),
      publishSourcePush: vi.fn(),
      recordDeliveryOnly: vi.fn(),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(connection)),
      deleteInstallationTokenSecret,
    });
    const request = signedInstallationRequest(deliveryId, installationId);

    const firstAttempt = processor.process(request);
    await expect(firstAttempt).rejects.toThrow('secret store unavailable');
    const retryResult = await processor.process(request);

    expect(retryResult).toEqual({outcome: 'duplicate', deliveryId});
    expect(deleteInstallationTokenSecret).toHaveBeenCalledTimes(2);
    expect(deleteInstallationTokenSecret).toHaveBeenLastCalledWith({
      workspaceId: connection.workspaceId,
      installationId,
    });
  });

  it('invalidates repository authorization after project repository metadata commits', async () => {
    const installationId = 8413;
    const connectionId = randomUUID();
    const connection = fakeConnection(connectionId);
    await githubInstallationFactory.create({
      connectionId,
      installationId: String(installationId),
    });
    const deliveryId = randomUUID();
    const invalidateRepositoryAuthorizationCache = vi.fn();
    const processor = createGithubWebhookProcessor({
      coreDb: db,
      publishIntegrationEventReceived: vi.fn(),
      publishSourceRepositoryUpdated: vi.fn(() => Promise.resolve({published: true})),
      publishSourcePush: vi.fn(),
      recordDeliveryOnly: vi.fn(),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(connection)),
      invalidateRepositoryAuthorizationCache,
    });

    const result = await processor.process(
      signedRequest(deliveryId, 'repository', {
        action: 'renamed',
        installation: {id: installationId},
        repository: {
          id: 42,
          name: 'platform',
          owner: {login: 'acme'},
          default_branch: 'main',
        },
      }),
    );

    expect(result).toEqual({outcome: 'processed', deliveryId});
    expect(invalidateRepositoryAuthorizationCache).toHaveBeenCalledWith(connectionId);
  });
});
