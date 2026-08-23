import {createHmac, randomUUID} from 'node:crypto';
import {sentryIssueActionSchema} from '@shipfox/api-integration-sentry-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import type {SentryApiClient} from '#api/client.js';
import {SentryIntegrationProviderError} from '#core/errors.js';
import {hashAuthorizationCode} from '#core/install.js';
import {db} from '#db/db.js';
import {sentryInstallations} from '#db/schema/installations.js';
import {
  sentryInstallationFactory,
  sentryInstallationWebhookFactory,
  sentryIssueWebhookFactory,
} from '#test/index.js';
import {createSentryWebhookRoutes} from './webhooks.js';

const CLIENT_SECRET = 'test-client-secret';
const URL = '/webhooks/integrations/sentry';

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

// The route persists through injected core functions (publishIntegrationEventReceived,
// recordDeliveryOnly, getIntegrationConnectionById, updateConnectionLifecycleStatus)
// that @shipfox/api-integration-core owns and wires in production. sentry only
// orchestrates them, so here we fake that interface with spies and assert the route's
// own behavior: signature/payload validation, resource routing, and which core function
// it calls with what mapped event. The persistence itself (outbox + delivery rows, dedup)
// is tested in core, against core's own tables. The route's reads/writes of sentry's own
// `installations` table are exercised for real against sentry's schema.
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

interface TestApp {
  app: FastifyInstance;
  sentry: SentryApiClient;
  publishIntegrationEventReceived: ReturnType<typeof vi.fn>;
  recordDeliveryOnly: ReturnType<typeof vi.fn>;
  getIntegrationConnectionById: ReturnType<typeof vi.fn>;
  updateConnectionLifecycleStatus: ReturnType<typeof vi.fn>;
}

async function createTestApp(
  options: {connection?: IntegrationConnection; sentry?: SentryApiClient} = {},
): Promise<TestApp> {
  const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
  const recordDeliveryOnly = vi.fn(() => Promise.resolve());
  const getIntegrationConnectionById = vi.fn(() =>
    Promise.resolve(options.connection ?? fakeConnection()),
  );
  const updateConnectionLifecycleStatus = vi.fn(() => Promise.resolve(undefined));
  const sentry = options.sentry ?? sentryClient();
  const routes = createSentryWebhookRoutes({
    sentry,
    coreDb: db,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
    getIntegrationConnectionById,
    updateConnectionLifecycleStatus,
  });
  const app = await createApp({routes: [routes], swagger: false});
  await app.ready();
  return {
    app,
    sentry,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
    getIntegrationConnectionById,
    updateConnectionLifecycleStatus,
  };
}

async function seedInstallation(
  installationUuid: string,
  options: {connectionId?: string | null; status?: 'installed' | 'deleted'; codeHash?: string} = {},
): Promise<void> {
  await sentryInstallationFactory.create({
    installationUuid,
    ...(options.connectionId !== undefined && {connectionId: options.connectionId}),
    ...(options.status !== undefined && {status: options.status}),
    ...(options.codeHash !== undefined && {codeHash: options.codeHash}),
  });
}

async function readInstallation(installationUuid: string) {
  const rows = await db()
    .select()
    .from(sentryInstallations)
    .where(eq(sentryInstallations.installationUuid, installationUuid))
    .limit(1);
  return rows[0];
}

function sign(rawBody: string): string {
  return createHmac('sha256', CLIENT_SECRET).update(rawBody).digest('hex');
}

function signedHeaders(
  rawBody: string,
  resource: string,
  deliveryId: string,
  opts: {legacy?: boolean} = {},
) {
  const signatureHeader = opts.legacy ? 'sentry-app-signature' : 'sentry-hook-signature';
  return {
    'content-type': 'application/json',
    'request-id': deliveryId,
    'sentry-hook-resource': resource,
    [signatureHeader]: sign(rawBody),
  };
}

describe('Sentry webhook route', () => {
  beforeEach(async () => {
    await closeApp();
    await db().delete(sentryInstallations);
  });

  afterEach(async () => {
    await closeApp();
  });

  test('publishes a mapped event for a valid signed issue from a known installation', async () => {
    const installationUuid = 'install-created';
    const connection = fakeConnection();
    await seedInstallation(installationUuid, {connectionId: connection.id});
    const {app, publishIntegrationEventReceived, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp({connection});
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryIssueWebhookFactory.build({action: 'created', installation: {uuid: installationUuid}}),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
    expect(getIntegrationConnectionById).toHaveBeenCalledTimes(1);
    expect(getIntegrationConnectionById).toHaveBeenCalledWith(
      connection.id,
      expect.objectContaining({tx: expect.anything()}),
    );
    expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
    const call = publishIntegrationEventReceived.mock.calls[0]?.[0];
    expect(call.tx).toBeDefined();
    expect(call.event).toMatchObject({
      source: connection.slug,
      event: 'issue.created',
      deliveryId,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      payload: {
        action: 'created',
        issueId: 'issue-123',
        title: 'TypeError: boom',
        webUrl: 'https://sentry.io/organizations/acme/issues/123/',
        issueUrl: 'https://sentry.io/api/0/issues/123/',
        projectUrl: 'https://sentry.io/api/0/projects/acme/web/',
      },
    });
  });

  describe.each(sentryIssueActionSchema.options)('action "%s"', (action) => {
    test(`publishes event issue.${action}`, async () => {
      const installationUuid = `install-${action}`;
      await seedInstallation(installationUuid);
      const {app, publishIntegrationEventReceived} = await createTestApp();
      const deliveryId = randomUUID();
      const body = JSON.stringify(
        sentryIssueWebhookFactory.build({action, installation: {uuid: installationUuid}}),
      );

      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: signedHeaders(body, 'issue', deliveryId),
        payload: body,
      });

      expect(res.statusCode).toBe(204);
      expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
      expect(publishIntegrationEventReceived.mock.calls[0]?.[0].event).toMatchObject({
        event: `issue.${action}`,
      });
    });
  });

  test('normalizes a raw "ignored" action to issue.archived', async () => {
    const installationUuid = 'install-ignored';
    await seedInstallation(installationUuid);
    const {app, publishIntegrationEventReceived} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryIssueWebhookFactory.build({action: 'ignored', installation: {uuid: installationUuid}}),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishIntegrationEventReceived.mock.calls[0]?.[0].event).toMatchObject({
      event: 'issue.archived',
      payload: {action: 'archived'},
    });
  });

  test('falls back the title to "Sentry issue" and maps nullable fields to null', async () => {
    const installationUuid = 'install-minimal';
    await seedInstallation(installationUuid);
    const {app, publishIntegrationEventReceived} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({
      action: 'created',
      installation: {uuid: installationUuid},
      data: {issue: {id: 'issue-bare'}},
    });

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishIntegrationEventReceived.mock.calls[0]?.[0].event.payload).toMatchObject({
      issueId: 'issue-bare',
      title: 'Sentry issue',
      shortId: null,
      culprit: null,
      webUrl: null,
      issueUrl: null,
      projectUrl: null,
      firstSeenAt: null,
      lastSeenAt: null,
    });
  });

  test('rejects an invalid signature with 401 and persists nothing', async () => {
    const installationUuid = 'install-badsig';
    await seedInstallation(installationUuid);
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryIssueWebhookFactory.build({action: 'created', installation: {uuid: installationUuid}}),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {
        'content-type': 'application/json',
        'request-id': deliveryId,
        'sentry-hook-resource': 'issue',
        'sentry-hook-signature': sign(`${body}tampered`),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  test('rejects a garbage/short signature with 401 (not 500) and persists nothing', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const body = JSON.stringify(
      sentryIssueWebhookFactory.build({action: 'created', installation: {uuid: 'x'}}),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {
        'content-type': 'application/json',
        'request-id': randomUUID(),
        'sentry-hook-resource': 'issue',
        'sentry-hook-signature': 'deadbeef',
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  test('returns 400 when Request-ID header is missing', async () => {
    const {app} = await createTestApp();
    const body = JSON.stringify(
      sentryIssueWebhookFactory.build({action: 'created', installation: {uuid: 'x'}}),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {
        'content-type': 'application/json',
        'sentry-hook-resource': 'issue',
        'sentry-hook-signature': sign(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
  });

  test('returns 400 when Sentry-Hook-Resource header is missing', async () => {
    const {app} = await createTestApp();
    const body = JSON.stringify(
      sentryIssueWebhookFactory.build({action: 'created', installation: {uuid: 'x'}}),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {
        'content-type': 'application/json',
        'request-id': randomUUID(),
        'sentry-hook-signature': sign(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
  });

  test('returns 401 when both signature headers are missing', async () => {
    const {app} = await createTestApp();
    const body = JSON.stringify(
      sentryIssueWebhookFactory.build({action: 'created', installation: {uuid: 'x'}}),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {
        'content-type': 'application/json',
        'request-id': randomUUID(),
        'sentry-hook-resource': 'issue',
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
  });

  test('accepts a valid signature supplied via the legacy sentry-app-signature header', async () => {
    const installationUuid = 'install-legacy';
    await seedInstallation(installationUuid);
    const {app, publishIntegrationEventReceived} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryIssueWebhookFactory.build({action: 'created', installation: {uuid: installationUuid}}),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId, {legacy: true}),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
  });

  test('forwards each delivery to publish (dedup is owned by core)', async () => {
    const installationUuid = 'install-dup';
    await seedInstallation(installationUuid);
    const {app, publishIntegrationEventReceived} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryIssueWebhookFactory.build({action: 'created', installation: {uuid: installationUuid}}),
    );
    const headers = signedHeaders(body, 'issue', deliveryId);
    publishIntegrationEventReceived
      .mockResolvedValueOnce({published: true})
      .mockResolvedValueOnce({published: false});

    const first = await app.inject({method: 'POST', url: URL, headers, payload: body});
    const second = await app.inject({method: 'POST', url: URL, headers, payload: body});

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);
    expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(2);
    expect(publishIntegrationEventReceived.mock.calls[0]?.[0].event.deliveryId).toBe(deliveryId);
    expect(publishIntegrationEventReceived.mock.calls[1]?.[0].event.deliveryId).toBe(deliveryId);
  });

  test('records the delivery only for issues from unknown installations', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryIssueWebhookFactory.build({action: 'created', installation: {uuid: 'unknown-uuid'}}),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnly.mock.calls[0]?.[0]).toMatchObject({provider: 'sentry', deliveryId});
  });

  test('records the delivery only for issues from a deleted installation', async () => {
    const installationUuid = 'install-deleted';
    await seedInstallation(installationUuid, {status: 'deleted'});
    const {app, publishIntegrationEventReceived, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryIssueWebhookFactory.build({action: 'created', installation: {uuid: installationUuid}}),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('records the delivery only when the installation has no connection', async () => {
    const installationUuid = 'install-noconn';
    await seedInstallation(installationUuid);
    const {app, publishIntegrationEventReceived, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp();
    getIntegrationConnectionById.mockResolvedValue(undefined);
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryIssueWebhookFactory.build({action: 'created', installation: {uuid: installationUuid}}),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(getIntegrationConnectionById).toHaveBeenCalledTimes(1);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('records the delivery only for an issue from a verified-but-unclaimed installation', async () => {
    const installationUuid = 'install-unclaimed';
    await seedInstallation(installationUuid, {connectionId: null});
    const {app, publishIntegrationEventReceived, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryIssueWebhookFactory.build({action: 'created', installation: {uuid: installationUuid}}),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('records the delivery only for a non-issue, non-installation resource', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({hello: 'world'});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'event_alert', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnly.mock.calls[0]?.[0]).toMatchObject({provider: 'sentry', deliveryId});
  });

  test('records the delivery only for an unknown issue action', async () => {
    const installationUuid = 'install-unknown-action';
    await seedInstallation(installationUuid);
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryIssueWebhookFactory.build({
        action: 'frobnicated',
        installation: {uuid: installationUuid},
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('records the delivery only for a malformed issue payload', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({action: 'created', installation: {uuid: 'x'}, data: {}});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('records the delivery only for bad JSON after a valid signature (no 400)', async () => {
    const {app, publishIntegrationEventReceived, recordDeliveryOnly} = await createTestApp();
    const body = '{not valid json';
    const deliveryId = randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'issue', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('installation/deleted disables the connection and marks the installation deleted', async () => {
    const installationUuid = 'install-lifecycle-del';
    const connectionId = randomUUID();
    await seedInstallation(installationUuid, {connectionId});
    const {app, recordDeliveryOnly, updateConnectionLifecycleStatus} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryInstallationWebhookFactory.build({
        action: 'deleted',
        data: {installation: {uuid: installationUuid}},
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'installation', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect((await readInstallation(installationUuid))?.status).toBe('deleted');
    expect(updateConnectionLifecycleStatus).toHaveBeenCalledTimes(1);
    expect(updateConnectionLifecycleStatus).toHaveBeenCalledWith(
      {id: connectionId, lifecycleStatus: 'disabled'},
      expect.objectContaining({tx: expect.anything()}),
    );
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('installation/deleted with no matching row writes a tombstone and does not disable', async () => {
    const {app, recordDeliveryOnly, updateConnectionLifecycleStatus} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryInstallationWebhookFactory.build({
        action: 'deleted',
        data: {installation: {uuid: 'never-installed'}},
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'installation', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect((await readInstallation('never-installed'))?.status).toBe('deleted');
    expect(updateConnectionLifecycleStatus).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('installation/created exchanges the code and persists a verified-unclaimed row', async () => {
    const installationUuid = 'install-created-webhook';
    const code = 'grant-code-webhook';
    const {app, sentry, recordDeliveryOnly} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryInstallationWebhookFactory.build({
        action: 'created',
        data: {installation: {uuid: installationUuid, code, organization: {slug: 'acme'}}},
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'installation', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(sentry.exchangeAuthorizationCode).toHaveBeenCalledWith({installationUuid, code});
    const row = await readInstallation(installationUuid);
    expect(row?.connectionId).toBeNull();
    expect(row?.status).toBe('installed');
    expect(row?.orgSlug).toBe('acme');
    expect(row?.codeHash).toBe(hashAuthorizationCode(code));
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('installation/created reconciles to a no-op when a row already exists', async () => {
    const installationUuid = 'install-created-existing';
    await seedInstallation(installationUuid, {connectionId: null, codeHash: 'pre-existing'});
    const {app, sentry, recordDeliveryOnly} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryInstallationWebhookFactory.build({
        action: 'created',
        data: {
          installation: {uuid: installationUuid, code: 'new-code', organization: {slug: 'acme'}},
        },
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'installation', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(sentry.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect((await readInstallation(installationUuid))?.codeHash).toBe('pre-existing');
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('installation/created without a code records-and-drops without persisting', async () => {
    const installationUuid = 'install-created-nocode';
    const {app, sentry, recordDeliveryOnly} = await createTestApp();
    const deliveryId = randomUUID();
    // Built literally rather than via the factory: the factory always supplies a
    // code and Fishery deep-merges, so an override cannot remove it.
    const body = JSON.stringify({
      action: 'created',
      data: {installation: {uuid: installationUuid, organization: {slug: 'acme'}}},
    });

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'installation', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(sentry.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(await readInstallation(installationUuid)).toBeUndefined();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  test('installation/created stays pending when access denied has no success checkpoint', async () => {
    const installationUuid = 'install-created-exchangefail';
    const {app, recordDeliveryOnly} = await createTestApp({
      sentry: sentryClient({
        exchangeAuthorizationCode: vi.fn(() =>
          Promise.reject(new SentryIntegrationProviderError('access-denied', 'spent')),
        ),
      }),
    });
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryInstallationWebhookFactory.build({
        action: 'created',
        data: {
          installation: {uuid: installationUuid, code: 'spent-code', organization: {slug: 'acme'}},
        },
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'installation', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(500);
    expect((await readInstallation(installationUuid))?.status).toBe('pending');
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  test('records the delivery only for a malformed installation payload', async () => {
    const {app, recordDeliveryOnly} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      sentryInstallationWebhookFactory.build({
        action: 'suspended',
        data: {installation: {uuid: 'x'}},
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: signedHeaders(body, 'installation', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });
});
