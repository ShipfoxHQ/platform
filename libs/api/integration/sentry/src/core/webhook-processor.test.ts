import {createHmac, randomUUID} from 'node:crypto';
import {createStoredWebhookRequest, type IntegrationConnection} from '@shipfox/api-integration-spi';
import {eq} from 'drizzle-orm';
import type {SentryApiClient} from '#api/client.js';
import {db} from '#db/db.js';
import {sentryInstallations} from '#db/schema/installations.js';
import {sentryInstallationFactory, sentryIssueWebhookFactory} from '#test/index.js';
import {createSentryWebhookProcessor} from './webhook-processor.js';

const CLIENT_SECRET = 'test-client-secret';

function fakeConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    provider: 'sentry',
    externalAccountId: 'install-uuid',
    slug: 'sentry_acme',
    displayName: 'Sentry acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function sentryClient(overrides: Partial<SentryApiClient> = {}): SentryApiClient {
  return {
    exchangeAuthorizationCode: vi.fn(() =>
      Promise.resolve({token: 'tok', refreshToken: 'refresh', expiresAt: 'x'}),
    ),
    getInstallation: vi.fn(() => Promise.resolve({orgSlug: 'acme'})),
    verifyInstallation: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function signedRequest(input: {body: unknown; deliveryId?: string; resource: string}) {
  const rawBody = Buffer.from(JSON.stringify(input.body));
  const signature = createHmac('sha256', CLIENT_SECRET).update(rawBody).digest('hex');

  return createStoredWebhookRequest({
    requestId: randomUUID(),
    routeId: 'sentry',
    receivedAt: new Date().toISOString(),
    rawQueryString: '',
    headers: {
      'content-type': 'application/json',
      'request-id': input.deliveryId ?? randomUUID(),
      'sentry-hook-resource': input.resource,
      'sentry-hook-signature': signature,
    },
    body: rawBody,
  });
}

describe('Sentry webhook processor', () => {
  beforeEach(async () => {
    await db().delete(sentryInstallations);
  });

  it('processes a valid issue delivery outside the HTTP adapter', async () => {
    const connection = fakeConnection();
    const installationUuid = 'processor-issue-installation';
    const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
    const processor = createSentryWebhookProcessor({
      sentry: sentryClient(),
      coreDb: db,
      publishIntegrationEventReceived,
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(connection)),
      updateConnectionLifecycleStatus: vi.fn(() => Promise.resolve(undefined)),
    });
    await sentryInstallationFactory.create({installationUuid, connectionId: connection.id});
    const request = signedRequest({
      resource: 'issue',
      body: sentryIssueWebhookFactory.build({
        action: 'created',
        installation: {uuid: installationUuid},
      }),
    });

    const result = await processor.process(request);

    expect(result).toMatchObject({outcome: 'processed'});
    expect(publishIntegrationEventReceived).toHaveBeenCalledOnce();
  });

  it('processes an installation deletion outside the HTTP adapter', async () => {
    const installationUuid = 'processor-installation-deletion';
    const updateConnectionLifecycleStatus = vi.fn(() => Promise.resolve(undefined));
    const processor = createSentryWebhookProcessor({
      sentry: sentryClient(),
      coreDb: db,
      publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: true})),
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(fakeConnection())),
      updateConnectionLifecycleStatus,
    });
    const connectionId = randomUUID();
    await sentryInstallationFactory.create({installationUuid, connectionId});
    const request = signedRequest({
      resource: 'installation',
      body: {action: 'deleted', data: {installation: {uuid: installationUuid}}},
    });

    const result = await processor.process(request);

    const [installation] = await db()
      .select()
      .from(sentryInstallations)
      .where(eq(sentryInstallations.installationUuid, installationUuid));
    expect(result).toMatchObject({outcome: 'processed'});
    expect(installation?.status).toBe('deleted');
    expect(updateConnectionLifecycleStatus).toHaveBeenCalledWith(
      {id: connectionId, lifecycleStatus: 'disabled'},
      expect.objectContaining({tx: expect.anything()}),
    );
  });

  it('does not create a side effect for an invalid signature', async () => {
    const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
    const processor = createSentryWebhookProcessor({
      sentry: sentryClient(),
      coreDb: db,
      publishIntegrationEventReceived,
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(fakeConnection())),
      updateConnectionLifecycleStatus: vi.fn(() => Promise.resolve(undefined)),
    });
    const request = signedRequest({
      resource: 'issue',
      body: sentryIssueWebhookFactory.build({action: 'created'}),
    });
    request.headers['sentry-hook-signature'] = 'not-a-signature';

    const result = await processor.process(request);

    expect(result).toMatchObject({outcome: 'discarded', reason: 'invalid_signature'});
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it('continues from the durable exchange checkpoint after completion persistence fails', async () => {
    const installationUuid = 'processor-installation-retry';
    const deliveryId = randomUUID();
    const exchangeAuthorizationCode = vi.fn(() =>
      Promise.resolve({token: 'tok', refreshToken: 'refresh', expiresAt: 'x'}),
    );
    const recordDeliveryOnly = vi
      .fn()
      .mockRejectedValueOnce(new Error('delivery persistence failed'))
      .mockResolvedValueOnce(undefined);
    const processor = createSentryWebhookProcessor({
      sentry: sentryClient({exchangeAuthorizationCode}),
      coreDb: db,
      publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: true})),
      recordDeliveryOnly,
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(fakeConnection())),
      updateConnectionLifecycleStatus: vi.fn(() => Promise.resolve(undefined)),
    });
    const request = signedRequest({
      deliveryId,
      resource: 'installation',
      body: {
        action: 'created',
        data: {
          installation: {
            uuid: installationUuid,
            code: 'single-use-code',
            organization: {slug: 'acme'},
          },
        },
      },
    });

    const firstAttempt = processor.process(request);
    await expect(firstAttempt).rejects.toThrow('delivery persistence failed');
    const checkpoint = await db()
      .select()
      .from(sentryInstallations)
      .where(eq(sentryInstallations.installationUuid, installationUuid));
    const retryResult = await processor.process(request);
    const [completed] = await db()
      .select()
      .from(sentryInstallations)
      .where(eq(sentryInstallations.installationUuid, installationUuid));

    expect(checkpoint[0]?.status).toBe('exchange-succeeded');
    expect(retryResult).toEqual({outcome: 'processed', deliveryId});
    expect(completed?.status).toBe('installed');
    expect(exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(2);
  });

  it('keeps deletion terminal when it races a pending installation exchange', async () => {
    const installationUuid = 'processor-installation-delete-race';
    let signalExchangeStarted = (): void => undefined;
    const exchangeStarted = new Promise<void>((resolve) => {
      signalExchangeStarted = resolve;
    });
    let finishExchange!: (authorization: {
      token: string;
      refreshToken: string;
      expiresAt: string;
    }) => void;
    const exchangeResult = new Promise<{
      token: string;
      refreshToken: string;
      expiresAt: string;
    }>((resolve) => {
      finishExchange = resolve;
    });
    const exchangeAuthorizationCode = vi.fn(() => {
      signalExchangeStarted();
      return exchangeResult;
    });
    const processor = createSentryWebhookProcessor({
      sentry: sentryClient({exchangeAuthorizationCode}),
      coreDb: db,
      publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: true})),
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(fakeConnection())),
      updateConnectionLifecycleStatus: vi.fn(() => Promise.resolve(undefined)),
    });
    const creation = signedRequest({
      resource: 'installation',
      body: {
        action: 'created',
        data: {
          installation: {
            uuid: installationUuid,
            code: 'single-use-code',
            organization: {slug: 'acme'},
          },
        },
      },
    });
    const deletion = signedRequest({
      resource: 'installation',
      body: {action: 'deleted', data: {installation: {uuid: installationUuid}}},
    });

    const creationAttempt = processor.process(creation);
    await exchangeStarted;
    const deletionResult = await processor.process(deletion);
    finishExchange({token: 'tok', refreshToken: 'refresh', expiresAt: 'x'});
    const creationResult = await creationAttempt;
    const [installation] = await db()
      .select()
      .from(sentryInstallations)
      .where(eq(sentryInstallations.installationUuid, installationUuid));

    expect(creationResult.outcome).toBe('processed');
    expect(deletionResult.outcome).toBe('processed');
    expect(installation?.status).toBe('deleted');
  });

  it('keeps an out-of-order deletion as a monotonic tombstone', async () => {
    const installationUuid = 'processor-installation-reordered';
    const exchangeAuthorizationCode = vi.fn(() =>
      Promise.resolve({token: 'tok', refreshToken: 'refresh', expiresAt: 'x'}),
    );
    const processor = createSentryWebhookProcessor({
      sentry: sentryClient({exchangeAuthorizationCode}),
      coreDb: db,
      publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: true})),
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(fakeConnection())),
      updateConnectionLifecycleStatus: vi.fn(() => Promise.resolve(undefined)),
    });
    const deletion = signedRequest({
      resource: 'installation',
      body: {action: 'deleted', data: {installation: {uuid: installationUuid}}},
    });
    const creation = signedRequest({
      resource: 'installation',
      body: {
        action: 'created',
        data: {
          installation: {
            uuid: installationUuid,
            code: 'single-use-code',
            organization: {slug: 'acme'},
          },
        },
      },
    });

    const deletionResult = await processor.process(deletion);
    const creationResult = await processor.process(creation);
    const [installation] = await db()
      .select()
      .from(sentryInstallations)
      .where(eq(sentryInstallations.installationUuid, installationUuid));

    expect(deletionResult.outcome).toBe('processed');
    expect(creationResult.outcome).toBe('processed');
    expect(installation?.status).toBe('deleted');
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
  });
});
