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
import type {GithubApiClient} from '#api/client.js';
import type {ConnectGithubInstallationInput} from '#core/install.js';
import {verifyGithubInstallState} from '#core/state.js';
import {createGithubIntegrationProvider} from '#index.js';

const requireWorkspaceMembershipMock = vi.fn(() => Promise.resolve());
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

function githubClient(overrides: Partial<GithubApiClient> = {}): GithubApiClient {
  return {
    exchangeOAuthCode: vi.fn(() => Promise.resolve('user-token')),
    listUserInstallations: vi.fn(() => Promise.resolve({installationIds: [123], nextCursor: null})),
    getInstallation: vi.fn(() =>
      Promise.resolve({
        id: 123,
        account: {login: 'shipfox', type: 'Organization'},
        repositorySelection: 'all',
        suspendedAt: null,
        htmlUrl: 'https://github.com/apps/shipfox/installations/123',
        raw: {id: 123},
      }),
    ),
    listInstallationRepositories: vi.fn(() =>
      Promise.resolve({repositories: [], nextCursor: null}),
    ),
    getRepository: vi.fn(() => {
      throw new Error('not used');
    }),
    listRepositoryFiles: vi.fn(() => Promise.resolve({files: [], nextCursor: null})),
    fetchRepositoryFile: vi.fn(() => {
      throw new Error('not used');
    }),
    createInstallationAccessToken: vi.fn(() =>
      Promise.resolve({
        token: 'ghs_installationtoken',
        expiresAt: new Date('2026-06-10T12:00:00.000Z'),
      }),
    ),
    ...overrides,
  };
}

interface CreateTestAppOptions {
  github?: GithubApiClient;
  existingConnection?: IntegrationConnection<'github'> | undefined;
  connectGithubInstallation?:
    | ((input: ConnectGithubInstallationInput) => Promise<IntegrationConnection<'github'>>)
    | undefined;
}

async function createTestApp(options: CreateTestAppOptions = {}): Promise<FastifyInstance> {
  const provider = createGithubIntegrationProvider({
    github: options.github ?? githubClient(),
    getExistingGithubConnection: vi.fn(() => Promise.resolve(options.existingConnection)),
    connectGithubInstallation:
      options.connectGithubInstallation ??
      vi.fn((input: ConnectGithubInstallationInput) => {
        const connection: IntegrationConnection<'github'> = {
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          provider: 'github',
          externalAccountId: input.installationId,
          slug: 'github_shipfox',
          displayName: input.displayName,
          lifecycleStatus: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        return Promise.resolve(connection);
      }),
    // Webhook receiver dependencies: install/OAuth tests don't exercise them.
    coreDb: vi.fn() as never,
    publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: false})),
    publishSourceRepositoryUpdated: vi.fn(() => Promise.resolve({published: false})),
    publishSourcePush: vi.fn(() => Promise.resolve({published: false})),
    recordDeliveryOnly: vi.fn(() => Promise.resolve()),
    getIntegrationConnectionById: vi.fn(() => Promise.resolve(undefined)),
    requireActiveWorkspaceMembership: requireWorkspaceMembershipMock,
  });
  const app = await createApp({
    auth: [fakeUserAuth],
    routes: provider.routes,
    swagger: false,
  });
  await app.ready();
  return app;
}

describe('GitHub integration routes', () => {
  beforeEach(async () => {
    authenticatedMemberships = [];
    await closeApp();
  });

  afterEach(async () => {
    await closeApp();
  });

  it('requires auth for install URL creation', async () => {
    const app = await createTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/github/install',
      payload: {workspace_id: crypto.randomUUID()},
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns an install URL with signed workspace state', async () => {
    const app = await createTestApp();
    const workspaceId = crypto.randomUUID();
    authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/github/install',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId},
    });

    const installUrl = new URL(res.json().install_url);
    const state = installUrl.searchParams.get('state');
    const claims = verifyGithubInstallState(state ?? '');
    expect(res.statusCode).toBe(200);
    expect(installUrl.toString()).toContain(
      'https://github.com/apps/shipfox-test/installations/new',
    );
    expect(claims.workspaceId).toBe(workspaceId);
    expect(claims.userId).toBe('user-1');
  });

  it('requires auth on the GitHub callback API', async () => {
    const app = await createTestApp();
    const state = await createInstallState(app, crypto.randomUUID());

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/github/callback/api?code=code&installation_id=123&state=${state}`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('handles a verified GitHub callback', async () => {
    const app = await createTestApp();
    const workspaceId = crypto.randomUUID();
    const state = await createInstallState(app, workspaceId);

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/github/callback/api?code=code&installation_id=123&state=${state}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().provider).toBe('github');
    expect(res.json().external_account_id).toBe('123');
    expect(requireWorkspaceMembershipMock).toHaveBeenCalledWith({
      workspaceId,
      userId: 'user-1',
      memberships: [{workspaceId, role: 'admin', workspaceStatus: 'active'}],
    });
  });

  it('rejects callbacks for inaccessible installations', async () => {
    const app = await createTestApp({
      github: githubClient({
        listUserInstallations: vi.fn(() =>
          Promise.resolve({installationIds: [999], nextCursor: null}),
        ),
      }),
    });
    const state = await createInstallState(app, crypto.randomUUID());

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/github/callback/api?code=code&installation_id=123&state=${state}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('github-installation-not-authorized');
  });

  it('returns 409 when the installation is already linked to another workspace', async () => {
    const app = await createTestApp({
      existingConnection: {
        id: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        provider: 'github',
        externalAccountId: '123',
        slug: 'github_shipfox',
        displayName: 'GitHub shipfox',
        lifecycleStatus: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const state = await createInstallState(app, crypto.randomUUID());

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/github/callback/api?code=code&installation_id=123&state=${state}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('github-installation-already-linked');
  });

  it('returns 409 when connection slug allocation conflicts repeatedly', async () => {
    const app = await createTestApp({
      connectGithubInstallation: vi.fn(() =>
        Promise.reject(new ConnectionSlugConflictError(new Error('duplicate slug'))),
      ),
    });
    const state = await createInstallState(app, crypto.randomUUID());

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/github/callback/api?code=code&installation_id=123&state=${state}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('slug-conflict');
  });
});

async function createInstallState(app: FastifyInstance, workspaceId: string): Promise<string> {
  authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
  const res = await app.inject({
    method: 'POST',
    url: '/integrations/github/install',
    headers: {authorization: 'Bearer user'},
    payload: {workspace_id: workspaceId},
  });
  const installUrl = new URL(res.json().install_url);
  const state = installUrl.searchParams.get('state');
  if (!state) throw new Error('Install URL did not include state');
  return encodeURIComponent(state);
}
