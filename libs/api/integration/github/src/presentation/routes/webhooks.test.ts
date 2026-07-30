import {createHmac, randomUUID} from 'node:crypto';
import {Webhooks} from '@octokit/webhooks';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import {db} from '#db/db.js';
import {githubInstallations} from '#db/schema/installations.js';
import {githubInstallationFactory, githubPushPayload} from '#test/index.js';
import {createGithubWebhookRoutes} from './webhooks.js';

const WEBHOOK_SECRET = 'test-webhook-secret';

// The route persists through injected core functions (publishSourcePush,
// recordDeliveryOnly, getIntegrationConnectionById) that @shipfox/api-integration-core
// owns and wires in production. github only orchestrates them, so here we fake that
// interface with spies and assert the route's own behavior: signature/payload
// validation and which core function it calls with what arguments. The persistence
// itself (outbox + delivery rows, dedup) is tested in core, against core's own tables.
function fakeConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    provider: 'github',
    externalAccountId: '123',
    slug: 'github_shipfox',
    displayName: 'GitHub shipfox',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface TestApp {
  app: FastifyInstance;
  publishIntegrationEventReceived: ReturnType<typeof vi.fn>;
  publishSourcePush: ReturnType<typeof vi.fn>;
  recordDeliveryOnly: ReturnType<typeof vi.fn>;
  getIntegrationConnectionById: ReturnType<typeof vi.fn>;
}

async function createTestApp(options: {connection?: IntegrationConnection} = {}): Promise<TestApp> {
  const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
  const publishSourcePush = vi.fn(() => Promise.resolve({published: true}));
  const recordDeliveryOnly = vi.fn(() => Promise.resolve());
  const getIntegrationConnectionById = vi.fn(() =>
    Promise.resolve(options.connection ?? fakeConnection()),
  );
  const routes = createGithubWebhookRoutes({
    coreDb: db,
    publishIntegrationEventReceived,
    publishSourcePush,
    recordDeliveryOnly,
    getIntegrationConnectionById,
  });
  const app = await createApp({routes: [routes], swagger: false});
  await app.ready();
  return {
    app,
    publishIntegrationEventReceived,
    publishSourcePush,
    recordDeliveryOnly,
    getIntegrationConnectionById,
  };
}

async function seedInstallation(installationId: number, connectionId?: string): Promise<void> {
  await githubInstallationFactory.create({
    installationId: String(installationId),
    ...(connectionId !== undefined && {connectionId}),
  });
}

function signedHeaders(rawBody: string, event: string, deliveryId: string) {
  const signature = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`;
  return {
    'content-type': 'application/json',
    'x-hub-signature-256': signature,
    'x-github-event': event,
    'x-github-delivery': deliveryId,
  };
}

describe('GitHub webhook route', () => {
  beforeEach(async () => {
    await closeApp();
    await db().delete(githubInstallations);
  });

  afterEach(async () => {
    await closeApp();
  });

  it('matches the @octokit/webhooks signature helper with raw HMAC', async () => {
    const body = JSON.stringify({hello: 'world'});

    const hooks = new Webhooks({secret: WEBHOOK_SECRET});
    const expected = await hooks.sign(body);
    const result = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`;

    expect(result).toBe(expected);
  });

  it('publishes a mapped event for a valid push from a known installation', async () => {
    const installationId = 7777;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const {app, publishSourcePush, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp({connection});
    const deliveryId = randomUUID();
    const rawPayload = githubPushPayload({
      installationId,
      repositoryId: 42,
      ref: 'refs/heads/main',
      defaultBranch: 'main',
      sha: 'abc123',
    });
    const body = JSON.stringify(rawPayload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
    expect(getIntegrationConnectionById).toHaveBeenCalledTimes(1);
    expect(getIntegrationConnectionById).toHaveBeenCalledWith(
      connection.id,
      expect.objectContaining({tx: expect.anything()}),
    );
    expect(publishSourcePush).toHaveBeenCalledTimes(1);
    const call = publishSourcePush.mock.calls[0]?.[0];
    expect(call.tx).toBeDefined();
    expect(call).toMatchObject({
      provider: 'github',
      deliveryId,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      connectionName: connection.displayName,
      rawPayload,
      push: {
        externalRepositoryId: 'github:42',
        ref: 'main',
        headCommitSha: 'abc123',
        isDefaultBranch: true,
      },
    });
  });

  it('publishes with isDefaultBranch=false when ref is not the default branch', async () => {
    const installationId = 7780;
    await seedInstallation(installationId);
    const {app, publishSourcePush} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      githubPushPayload({
        installationId,
        repositoryId: 200,
        ref: 'refs/heads/feature/x',
        defaultBranch: 'main',
        sha: 'feat1',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishSourcePush).toHaveBeenCalledTimes(1);
    expect(publishSourcePush.mock.calls[0]?.[0].push).toMatchObject({
      ref: 'feature/x',
      isDefaultBranch: false,
    });
  });

  it('publishes a generic envelope for a branch deletion without publishing a typed push', async () => {
    const installationId = 7783;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const {app, publishIntegrationEventReceived, publishSourcePush, recordDeliveryOnly} =
      await createTestApp({connection});
    const deliveryId = randomUUID();
    const rawPayload = githubPushPayload({
      installationId,
      repositoryId: 42,
      ref: 'refs/heads/main',
      defaultBranch: 'main',
      sha: '0000000000000000000000000000000000000000',
    });
    const body = JSON.stringify(rawPayload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
    expect(publishIntegrationEventReceived.mock.calls[0]?.[0]).toMatchObject({
      event: {
        source: connection.slug,
        event: 'push',
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        connectionName: connection.displayName,
        deliveryId,
        payload: rawPayload,
      },
    });
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('records the delivery only for events without an installation id', async () => {
    const {app, publishIntegrationEventReceived, publishSourcePush, recordDeliveryOnly} =
      await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({zen: 'Practicality beats purity.'});

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'ping', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnly.mock.calls[0]?.[0]).toMatchObject({provider: 'github', deliveryId});
  });

  it('publishes a generic envelope for a non-push event with an action', async () => {
    const installationId = 7784;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const {app, publishIntegrationEventReceived, publishSourcePush, recordDeliveryOnly} =
      await createTestApp({connection});
    const deliveryId = randomUUID();
    const rawPayload = {
      action: 'opened',
      installation: {id: installationId},
      repository: {id: 42, full_name: 'shipfox/platform'},
      pull_request: {
        number: 17,
        head: {repo: {id: 42, full_name: 'shipfox/platform'}},
        base: {repo: {id: 42, full_name: 'shipfox/platform'}},
      },
    };
    const body = JSON.stringify(rawPayload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'pull_request', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
    expect(publishIntegrationEventReceived.mock.calls[0]?.[0]).toMatchObject({
      event: {
        source: connection.slug,
        event: 'pull_request.opened',
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        connectionName: connection.displayName,
        deliveryId,
        payload: rawPayload,
      },
    });
  });

  it('records and drops a pull request opened from a fork', async () => {
    const {app, publishIntegrationEventReceived, publishSourcePush, recordDeliveryOnly} =
      await createTestApp();
    const deliveryId = randomUUID();
    const rawPayload = {
      action: 'opened',
      installation: {id: 7787},
      repository: {id: 42, full_name: 'shipfox/platform'},
      pull_request: {
        head: {repo: {id: 84, full_name: 'contributor/platform'}},
        base: {repo: {id: 42, full_name: 'shipfox/platform'}},
      },
    };
    const body = JSON.stringify(rawPayload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'pull_request', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnly.mock.calls[0]?.[0]).toMatchObject({provider: 'github', deliveryId});
  });

  it('publishes a generic envelope for a non-push event without an action', async () => {
    const installationId = 7785;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const {app, publishIntegrationEventReceived, publishSourcePush, recordDeliveryOnly} =
      await createTestApp({connection});
    const deliveryId = randomUUID();
    const rawPayload = {
      installation: {id: installationId},
      forkee: {full_name: 'shipfox/forked'},
    };
    const body = JSON.stringify(rawPayload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'fork', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
    expect(publishIntegrationEventReceived.mock.calls[0]?.[0]).toMatchObject({
      event: {
        source: connection.slug,
        event: 'fork',
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        connectionName: connection.displayName,
        deliveryId,
        payload: rawPayload,
      },
    });
  });

  it('records the delivery only for pushes from unknown installations', async () => {
    const {app, publishSourcePush, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      githubPushPayload({
        installationId: 999999,
        repositoryId: 300,
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'orphan',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnly.mock.calls[0]?.[0]).toMatchObject({provider: 'github', deliveryId});
  });

  it('records the delivery only when the installation has no connection', async () => {
    const installationId = 7781;
    const {app, publishSourcePush, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp();
    getIntegrationConnectionById.mockResolvedValue(undefined);
    await seedInstallation(installationId);
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      githubPushPayload({
        installationId,
        repositoryId: 301,
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'dangling',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(getIntegrationConnectionById).toHaveBeenCalledTimes(1);
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnly.mock.calls[0]?.[0]).toMatchObject({provider: 'github', deliveryId});
  });

  it.each([
    'disabled',
    'error',
  ] as const)('records the delivery only when the connection is %s', async (lifecycleStatus) => {
    const installationId = 7782;
    const connection = fakeConnection({lifecycleStatus});
    const {app, publishSourcePush, recordDeliveryOnly, getIntegrationConnectionById} =
      await createTestApp({connection});
    await seedInstallation(installationId, connection.id);
    const deliveryId = randomUUID();
    const body = JSON.stringify(
      githubPushPayload({
        installationId,
        repositoryId: 302,
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'inactive',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(getIntegrationConnectionById).toHaveBeenCalledTimes(1);
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnly.mock.calls[0]?.[0]).toMatchObject({provider: 'github', deliveryId});
  });

  it('records the delivery only when a push payload has no installation id', async () => {
    const {app, publishSourcePush, recordDeliveryOnly} = await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({
      ref: 'refs/heads/main',
      after: 'abc',
      repository: {id: 42, default_branch: 'main'},
    });

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnly.mock.calls[0]?.[0]).toMatchObject({provider: 'github', deliveryId});
  });

  it('records the delivery only when a malformed push payload has no installation id', async () => {
    const {app, publishIntegrationEventReceived, publishSourcePush, recordDeliveryOnly} =
      await createTestApp();
    const deliveryId = randomUUID();
    const body = JSON.stringify({ref: 'refs/heads/main'});

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnly.mock.calls[0]?.[0]).toMatchObject({provider: 'github', deliveryId});
  });

  it('rejects an invalid signature with 401 and persists nothing', async () => {
    const {app, publishSourcePush, recordDeliveryOnly} = await createTestApp();
    const body = JSON.stringify(
      githubPushPayload({
        installationId: 7779,
        repositoryId: 100,
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'zzz',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=deadbeef',
        'x-github-event': 'push',
        'x-github-delivery': randomUUID(),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('rejects malformed signature headers (verify throws) with 401', async () => {
    const {app, publishSourcePush, recordDeliveryOnly} = await createTestApp();
    const body = JSON.stringify(
      githubPushPayload({
        installationId: 7782,
        repositoryId: 101,
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'aaa',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'not-a-real-signature-format',
        'x-github-event': 'push',
        'x-github-delivery': randomUUID(),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON after a valid signature with 400', async () => {
    const {app, publishSourcePush, recordDeliveryOnly} = await createTestApp();
    const body = '{not valid json';

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'push', randomUUID()),
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({error: 'malformed JSON'});
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('publishes a generic envelope when a routable push payload fails schema validation', async () => {
    const installationId = 7786;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const {app, publishIntegrationEventReceived, publishSourcePush, recordDeliveryOnly} =
      await createTestApp({connection});
    const deliveryId = randomUUID();
    const rawPayload = {ref: 'refs/heads/main', installation: {id: installationId}};
    const body = JSON.stringify(rawPayload);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/integrations/github',
      headers: signedHeaders(body, 'push', deliveryId),
      payload: body,
    });

    expect(res.statusCode).toBe(204);
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
    expect(publishIntegrationEventReceived.mock.calls[0]?.[0]).toMatchObject({
      event: {
        source: connection.slug,
        event: 'push',
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        deliveryId,
        payload: rawPayload,
      },
    });
  });
});
