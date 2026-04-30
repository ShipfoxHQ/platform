import {AUTH_USER, setUserContext} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import type {GithubApiClient} from '#api/client.js';
import {verifyGithubInstallState} from '#core/state.js';
import {createGithubIntegrationProvider} from '#index.js';

vi.mock('@shipfox/api-workspaces', () => ({
  requireMembership: vi.fn(({workspaceId}) =>
    Promise.resolve({
      workspaceId,
      workspace: {
        id: workspaceId,
        name: 'Workspace',
        status: 'active',
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      userId: 'user-1',
    }),
  ),
  requireWorkspaceMembership: vi.fn(() => Promise.resolve()),
}));

const {requireMembership, requireWorkspaceMembership} = await import('@shipfox/api-workspaces');
const requireMembershipMock = vi.mocked(requireMembership);
const requireWorkspaceMembershipMock = vi.mocked(requireWorkspaceMembership);

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    setUserContext(request, {userId: 'user-1', email: 'user@example.com'});
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
    ...overrides,
  };
}

async function createTestApp(github = githubClient()): Promise<FastifyInstance> {
  const provider = createGithubIntegrationProvider({
    github,
    connectGithubInstallation: vi.fn((input) =>
      Promise.resolve({
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        provider: 'github',
        externalAccountId: input.installationId,
        displayName: input.displayName,
        lifecycleStatus: 'active',
        capabilities: ['source_control'],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
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
    expect(requireMembershipMock).toHaveBeenCalledWith(expect.objectContaining({workspaceId}));
  });

  it('handles a verified GitHub callback', async () => {
    const app = await createTestApp();
    const workspaceId = crypto.randomUUID();
    const state = await createInstallState(app, workspaceId);

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/github/callback?code=code&installation_id=123&state=${state}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().provider).toBe('github');
    expect(res.json().external_account_id).toBe('123');
    expect(requireWorkspaceMembershipMock).toHaveBeenCalledWith({
      workspaceId,
      userId: 'user-1',
    });
  });

  it('rejects callbacks for inaccessible installations', async () => {
    const app = await createTestApp(
      githubClient({
        listUserInstallations: vi.fn(() =>
          Promise.resolve({installationIds: [999], nextCursor: null}),
        ),
      }),
    );
    const state = await createInstallState(app, crypto.randomUUID());

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/github/callback?code=code&installation_id=123&state=${state}`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('github-installation-not-authorized');
  });
});

async function createInstallState(app: FastifyInstance, workspaceId: string): Promise<string> {
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
