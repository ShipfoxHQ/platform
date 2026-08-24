import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {GiteaApiClient, GiteaRepository} from '#api/client.js';

const REPOSITORY: GiteaRepository = {
  ownerLogin: 'shipfox',
  name: 'platform',
  fullName: 'shipfox/platform',
  defaultBranch: 'main',
  private: true,
  cloneUrl: 'https://gitea.example.com/shipfox/platform.git',
  htmlUrl: 'https://gitea.example.com/shipfox/platform',
};

function giteaClient(repository: GiteaRepository): GiteaApiClient {
  return {
    listOrgRepositories: vi.fn(),
    getRepository: vi.fn(() => Promise.resolve(repository)),
    resolveRef: vi.fn(),
    getBranch: vi.fn(),
    getTag: vi.fn(),
    listTree: vi.fn(),
    fetchFileContent: vi.fn(),
    getIssue: vi.fn(),
    createIssueComment: vi.fn(),
    organizationExists: vi.fn(),
  };
}

function connection(): IntegrationConnection<'gitea'> {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provider: 'gitea',
    externalAccountId: 'shipfox',
    slug: 'gitea_shipfox',
    displayName: 'Gitea shipfox',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function createCheckoutSpec(repository: GiteaRepository) {
  const {GiteaSourceControlProvider} = await import('./source-control.js');
  const provider = new GiteaSourceControlProvider(giteaClient(repository));

  return provider.createCheckoutSpec({
    connection: connection(),
    externalRepositoryId: 'gitea:shipfox/platform',
  });
}

describe('GiteaSourceControlProvider clone URL override', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses the provider clone URL when GITEA_CLONE_BASE_URL is unset', async () => {
    vi.resetModules();

    const result = await createCheckoutSpec(REPOSITORY);

    expect(result.repositoryUrl).toBe('https://gitea.example.com/shipfox/platform.git');
  });

  it('replaces the checkout clone URL origin when GITEA_CLONE_BASE_URL is set', async () => {
    vi.stubEnv('GITEA_CLONE_BASE_URL', 'http://gitea:3000');
    vi.resetModules();

    const result = await createCheckoutSpec(REPOSITORY);

    expect(result.repositoryUrl).toBe('http://gitea:3000/shipfox/platform.git');
  });

  it('keeps a non-root repository path prefix from the provider clone URL', async () => {
    vi.stubEnv('GITEA_CLONE_BASE_URL', 'http://gitea:3000');
    vi.resetModules();

    const result = await createCheckoutSpec({
      ...REPOSITORY,
      cloneUrl: 'https://gitea.example.com/git/shipfox/platform.git',
    });

    expect(result.repositoryUrl).toBe('http://gitea:3000/git/shipfox/platform.git');
  });
});
