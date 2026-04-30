import {sql} from 'drizzle-orm';
import type {GithubApiClient} from '#api/client.js';
import {db} from '#db/db.js';
import {upsertGithubInstallation} from '#db/installations.js';
import {GithubIntegrationProviderError} from './errors.js';
import {GithubSourceControlProvider} from './source-control.js';

function githubClient(overrides: Partial<GithubApiClient> = {}): GithubApiClient {
  return {
    exchangeOAuthCode: vi.fn(() => Promise.resolve('token')),
    listUserInstallations: vi.fn(() => Promise.resolve({installationIds: [], nextCursor: null})),
    getInstallation: vi.fn(() => {
      throw new Error('not used');
    }),
    listInstallationRepositories: vi.fn(() =>
      Promise.resolve({
        repositories: [
          {
            id: 42,
            ownerLogin: 'shipfox',
            name: 'platform',
            fullName: 'shipfox/platform',
            defaultBranch: 'main',
            private: true,
            visibility: 'private',
            cloneUrl: 'https://github.com/shipfox/platform.git',
            htmlUrl: 'https://github.com/shipfox/platform',
          },
        ],
        nextCursor: '2',
      }),
    ),
    ...overrides,
  };
}

describe('GithubSourceControlProvider', () => {
  let connectionId: string;
  let installationId: number;

  beforeEach(() => {
    connectionId = crypto.randomUUID();
    installationId = Math.floor(Math.random() * 1_000_000) + 1;
  });

  async function createConnectionWithInstallation(): Promise<void> {
    await db().execute(sql`
      INSERT INTO integrations_connections (
        id,
        workspace_id,
        provider,
        external_account_id,
        display_name,
        lifecycle_status,
        capabilities
      )
      VALUES (
        ${connectionId},
        ${crypto.randomUUID()},
        'github',
        ${String(installationId)},
        'GitHub shipfox',
        'active',
        ARRAY['source_control']
      )
    `);
    await upsertGithubInstallation({
      connectionId,
      installationId: String(installationId),
      accountLogin: 'shipfox',
      accountType: 'Organization',
      repositorySelection: 'all',
      latestEvent: {id: 123},
    });
  }

  it('lists repositories using installation auth metadata', async () => {
    await createConnectionWithInstallation();
    const github = githubClient();
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.listRepositories({
      connection: {
        id: connectionId,
        workspaceId: crypto.randomUUID(),
        provider: 'github',
        externalAccountId: '123',
        displayName: 'GitHub shipfox',
        lifecycleStatus: 'active',
        capabilities: ['source_control'],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      limit: 50,
    });

    expect(result.repositories[0]?.externalRepositoryId).toBe('42');
    expect(result.repositories[0]?.visibility).toBe('private');
    expect(result.nextCursor).toBe('2');
    expect(github.listInstallationRepositories).toHaveBeenCalledWith({
      installationId,
      limit: 50,
      cursor: undefined,
    });
  });

  it('resolves repositories by external id across pages', async () => {
    await createConnectionWithInstallation();
    const github = githubClient({
      listInstallationRepositories: vi
        .fn()
        .mockResolvedValueOnce({repositories: [], nextCursor: '2'})
        .mockResolvedValueOnce({
          repositories: [
            {
              id: 42,
              ownerLogin: 'shipfox',
              name: 'platform',
              fullName: 'shipfox/platform',
              defaultBranch: 'main',
              private: true,
              cloneUrl: 'https://github.com/shipfox/platform.git',
              htmlUrl: 'https://github.com/shipfox/platform',
            },
          ],
          nextCursor: null,
        }),
    });
    const provider = new GithubSourceControlProvider(github);

    const result = await provider.resolveRepository({
      connection: {
        id: connectionId,
        workspaceId: crypto.randomUUID(),
        provider: 'github',
        externalAccountId: '123',
        displayName: 'GitHub shipfox',
        lifecycleStatus: 'active',
        capabilities: ['source_control'],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      externalRepositoryId: '42',
    });

    expect(result.fullName).toBe('shipfox/platform');
  });

  it('rejects missing installation metadata', async () => {
    const provider = new GithubSourceControlProvider(githubClient());

    const result = provider.listRepositories({
      connection: {
        id: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        provider: 'github',
        externalAccountId: '123',
        displayName: 'GitHub shipfox',
        lifecycleStatus: 'active',
        capabilities: ['source_control'],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      limit: 50,
    });

    await expect(result).rejects.toBeInstanceOf(GithubIntegrationProviderError);
  });
});
