import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import {
  ConnectionSlugConflictError,
  type IntegrationConnection,
} from '@shipfox/api-integration-spi';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import type {SentryApiClient} from '#api/client.js';
import {SentryIntegrationProviderError} from '#core/errors.js';
import type {ConnectSentryInstallationInput} from '#core/install.js';
import type {SentryInstallation} from '#db/installations.js';
import {createSentryIntegrationProvider} from '#index.js';

let authenticatedMemberships: UserContextMembership[] = [];

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }
    setUserContext(
      request,
      buildUserContext({
        userId: 'user-1',
        email: 'user@example.com',
        memberships: authenticatedMemberships,
      }),
    );
    return Promise.resolve();
  },
};

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

function unclaimedInstallation(overrides: Partial<SentryInstallation> = {}): SentryInstallation {
  return {
    id: 'row-1',
    connectionId: null,
    installationUuid: 'install-uuid-1',
    orgSlug: 'acme',
    status: 'installed',
    codeHash: null,
    installerUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface CreateTestAppOptions {
  sentry?: SentryApiClient;
  installation?: SentryInstallation | undefined;
  existingConnection?: IntegrationConnection<'sentry'> | undefined;
  connectSentryInstallation?:
    | ((input: ConnectSentryInstallationInput) => Promise<IntegrationConnection<'sentry'>>)
    | undefined;
}

async function createTestApp(options: CreateTestAppOptions = {}): Promise<FastifyInstance> {
  const provider = createSentryIntegrationProvider({
    sentry: options.sentry ?? sentryClient(),
    getSentryInstallation: vi.fn(() => Promise.resolve(options.installation)),
    getConnectionById: vi.fn(() => Promise.resolve(options.existingConnection)),
    persistVerifiedUnclaimedInstallation: vi.fn((input) =>
      Promise.resolve(unclaimedInstallation({...input})),
    ),
    connectSentryInstallation:
      options.connectSentryInstallation ??
      vi.fn((input) =>
        Promise.resolve({
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          provider: 'sentry' as const,
          externalAccountId: input.installationUuid,
          slug: 'sentry_acme',
          displayName: input.displayName,
          lifecycleStatus: 'active' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          repositoryAccessMode: 'selected' as const,
        }),
      ),
    // Webhook receiver dependencies: install/connect tests don't exercise them.
    coreDb: vi.fn() as never,
    publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: false})),
    recordDeliveryOnly: vi.fn(() => Promise.resolve()),
    getIntegrationConnectionById: vi.fn(() => Promise.resolve(undefined)),
    updateConnectionLifecycleStatus: vi.fn(() => Promise.resolve(undefined)),
  });
  const app = await createApp({auth: [fakeUserAuth], routes: provider.routes, swagger: false});
  await app.ready();
  return app;
}

function connectPayload(options: {authorize?: boolean} = {}) {
  const workspaceId = crypto.randomUUID();
  if (options.authorize !== false) {
    authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
  }
  return {
    workspace_id: workspaceId,
    code: 'the-code',
    installation_id: 'install-uuid-1',
  };
}

describe('Sentry integration routes', () => {
  beforeEach(async () => {
    authenticatedMemberships = [];
    await closeApp();
  });

  afterEach(async () => {
    await closeApp();
  });

  it('requires auth for the install URL', async () => {
    const app = await createTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/sentry/install',
      payload: {workspace_id: crypto.randomUUID()},
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns the external-install URL for a member', async () => {
    const app = await createTestApp();
    const workspaceId = crypto.randomUUID();
    authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/sentry/install',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().install_url).toBe(
      'https://sentry.io/sentry-apps/shipfox-test/external-install/',
    );
  });

  it('requires auth for connect', async () => {
    const app = await createTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/sentry/connect',
      payload: connectPayload(),
    });

    expect(res.statusCode).toBe(401);
  });

  it('connects an installation and returns a connection DTO with no capabilities', async () => {
    const app = await createTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/sentry/connect',
      headers: {authorization: 'Bearer user'},
      payload: connectPayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().provider).toBe('sentry');
    expect(res.json().external_account_id).toBe('install-uuid-1');
    expect(res.json().display_name).toBe('Sentry acme');
    expect(res.json().capabilities).toEqual([]);
  });

  it('returns 403 when the caller is not a workspace member', async () => {
    const app = await createTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/sentry/connect',
      headers: {authorization: 'Bearer user'},
      payload: connectPayload({authorize: false}),
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 409 when the installation is already linked to another workspace', async () => {
    const connectionId = crypto.randomUUID();
    const app = await createTestApp({
      installation: unclaimedInstallation({connectionId}),
      existingConnection: {
        id: connectionId,
        workspaceId: crypto.randomUUID(),
        provider: 'sentry',
        externalAccountId: 'install-uuid-1',
        slug: 'sentry_acme',
        displayName: 'Sentry acme',
        lifecycleStatus: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        repositoryAccessMode: 'selected',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/sentry/connect',
      headers: {authorization: 'Bearer user'},
      payload: connectPayload(),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('sentry-installation-already-linked');
  });

  it('returns 409 when connection slug allocation conflicts repeatedly', async () => {
    const app = await createTestApp({
      connectSentryInstallation: vi.fn(() =>
        Promise.reject(new ConnectionSlugConflictError(new Error('duplicate slug'))),
      ),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/sentry/connect',
      headers: {authorization: 'Bearer user'},
      payload: connectPayload(),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('slug-conflict');
  });

  it('maps a non-access-denied provider error to its status', async () => {
    const app = await createTestApp({
      sentry: sentryClient({
        exchangeAuthorizationCode: vi.fn(() =>
          Promise.reject(new SentryIntegrationProviderError('rate-limited', 'slow down')),
        ),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/sentry/connect',
      headers: {authorization: 'Bearer user'},
      payload: connectPayload(),
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('rate-limited');
  });

  it('returns a retryable 503 when a concurrent webhook is still verifying the install', async () => {
    const app = await createTestApp({
      sentry: sentryClient({
        exchangeAuthorizationCode: vi.fn(() =>
          Promise.reject(new SentryIntegrationProviderError('access-denied', 'already used')),
        ),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/sentry/connect',
      headers: {authorization: 'Bearer user'},
      payload: connectPayload(),
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('sentry-verification-in-progress');
  });

  it('returns 403 when the presented code cannot prove control of a verified install', async () => {
    const app = await createTestApp({
      installation: unclaimedInstallation({codeHash: 'a-different-hash'}),
      sentry: sentryClient({
        exchangeAuthorizationCode: vi.fn(() =>
          Promise.reject(new SentryIntegrationProviderError('access-denied', 'already used')),
        ),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/sentry/connect',
      headers: {authorization: 'Bearer user'},
      payload: connectPayload(),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('sentry-claim-proof-mismatch');
  });

  it('returns 409 when the installation is tombstoned', async () => {
    const app = await createTestApp({
      installation: unclaimedInstallation({status: 'deleted'}),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/sentry/connect',
      headers: {authorization: 'Bearer user'},
      payload: connectPayload(),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('sentry-installation-deleted');
  });
});
