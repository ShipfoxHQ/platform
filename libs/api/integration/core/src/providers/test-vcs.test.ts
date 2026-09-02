import type {
  CheckoutCredentials,
  IntegrationConnection,
  RepositorySnapshot,
} from '@shipfox/api-integration-spi';
import {
  TestVcsSourceControlProvider,
  type TestVcsSourceControlProviderOptions,
} from '#providers/test-vcs.js';

const repository: RepositorySnapshot = {
  externalRepositoryId: 'test-vcs:e2e-owner/repository',
  owner: 'e2e-owner',
  name: 'repository',
  fullName: 'e2e-owner/repository',
  defaultBranch: 'main',
  visibility: 'private',
  cloneUrl: 'https://127.0.0.1:16113/e2e-owner/repository.git',
  htmlUrl: 'https://test-vcs.invalid/e2e-owner/repository',
};

const connection: IntegrationConnection<'test-vcs'> = {
  id: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  provider: 'test-vcs',
  externalAccountId: 'e2e-owner',
  slug: 'test_vcs_e2e_owner',
  displayName: 'Test VCS',
  lifecycleStatus: 'active',
  repositoryAccessMode: 'all',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function credential(generation: string): CheckoutCredentials {
  return {
    username: 'x-access-token',
    token: `token-${generation}`,
    expiresAt: new Date(Date.now() + 60_000),
    generation,
    renewal: {mode: 'on-rejection'},
  };
}

function providerFixture(options: {
  issueCredential: TestVcsSourceControlProviderOptions['fixture']['issueCredential'];
}): TestVcsSourceControlProvider {
  const fixture = {
    getRepository: () => repository,
    issueCredential: options.issueCredential,
  } as unknown as TestVcsSourceControlProviderOptions['fixture'];
  return new TestVcsSourceControlProvider({fixture, credentialTtlSeconds: 3});
}

function checkoutInput(
  options: {permissions?: 'read' | 'write'; rejectedGeneration?: string} = {},
) {
  return {
    connection,
    externalRepositoryId: repository.externalRepositoryId,
    permissions: {contents: options.permissions ?? ('read' as const)},
    ...(options.rejectedGeneration === undefined
      ? {}
      : {rejectedGeneration: options.rejectedGeneration}),
  };
}

describe('Test VCS source-control provider', () => {
  it('shares one exact-scope credential mint across concurrent requests', async () => {
    const minted = credential('generation-a');
    const issueCredential = vi.fn().mockReturnValue(minted);
    const provider = providerFixture({issueCredential});

    const results = await Promise.all([
      provider.createCheckoutCredentials(checkoutInput()),
      provider.createCheckoutCredentials(checkoutInput()),
    ]);

    expect(results).toEqual([minted, minted]);
    expect(issueCredential).toHaveBeenCalledOnce();
  });

  it('keeps repository and permission scopes isolated', async () => {
    const issueCredential = vi
      .fn()
      .mockReturnValueOnce(credential('read'))
      .mockReturnValueOnce(credential('write'))
      .mockReturnValueOnce(credential('other-repository'));
    const provider = providerFixture({issueCredential});

    await provider.createCheckoutCredentials(checkoutInput({permissions: 'read'}));
    await provider.createCheckoutCredentials(checkoutInput({permissions: 'write'}));
    await provider.createCheckoutCredentials({
      ...checkoutInput({permissions: 'read'}),
      externalRepositoryId: 'test-vcs:e2e-owner/other-repository',
    });

    expect(issueCredential).toHaveBeenCalledTimes(3);
  });

  it('mints a fresh generation for the rejected credential without evicting a newer one', async () => {
    const issueCredential = vi
      .fn()
      .mockReturnValueOnce(credential('generation-a'))
      .mockReturnValueOnce(credential('generation-b'));
    const provider = providerFixture({issueCredential});

    await expect(provider.createCheckoutCredentials(checkoutInput())).resolves.toMatchObject({
      generation: 'generation-a',
    });
    await expect(
      provider.createCheckoutCredentials(checkoutInput({rejectedGeneration: 'generation-a'})),
    ).resolves.toMatchObject({generation: 'generation-b'});
    await expect(
      provider.createCheckoutCredentials(checkoutInput({rejectedGeneration: 'generation-a'})),
    ).resolves.toMatchObject({generation: 'generation-b'});

    expect(issueCredential).toHaveBeenCalledTimes(2);
  });

  it('supplies the provider author for write checkouts', async () => {
    const provider = providerFixture({
      issueCredential: vi.fn().mockReturnValue(credential('write')),
    });

    await expect(
      provider.createCheckoutSpec(checkoutInput({permissions: 'write'})),
    ).resolves.toMatchObject({
      gitAuthor: {name: 'Shipfox Test VCS', email: 'test-vcs@shipfox.test'},
    });
  });
});
