import {githubEventCatalog} from '@shipfox/api-integration-github-dto';
import {
  githubCheckoutTokenNamespace,
  githubProviderInstanceFingerprint,
} from '#api/github-checkout-token-cache.js';
import {githubInstallationTokenNamespace} from '#api/installation-token-envelope.js';
import {createGithubIntegrationProvider} from '#index.js';

const {createProcessor, state} = vi.hoisted(() => {
  const state: {processorOptions: unknown} = {processorOptions: undefined};
  return {
    state,
    createProcessor: vi.fn((options: unknown) => {
      state.processorOptions = options;
      return {process: vi.fn()};
    }),
  };
});

vi.mock('#core/webhook-processor.js', () => ({
  createGithubWebhookProcessor: createProcessor,
}));

describe('createGithubIntegrationProvider', () => {
  it.each([
    ['unclassified', 'unclassified'],
    ['enforced', 'enforced'],
  ] as const)('preserves the composed repository authorization state: %s', (_label, state) => {
    const provider = createGithubIntegrationProvider({
      github: {} as never,
      getExistingGithubConnection: vi.fn(() => Promise.resolve(undefined)),
      connectGithubInstallation: vi.fn() as never,
      coreDb: vi.fn() as never,
      publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: false})),
      publishSourceRepositoryUpdated: vi.fn(() => Promise.resolve({published: false})),
      publishSourcePush: vi.fn(() => Promise.resolve({published: false})),
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(undefined)),
      repositoryAuthorization: state,
    });

    expect(provider.repositoryAuthorization).toBe(state);
    expect(provider.adapters?.source_control?.checkoutRepositoryAuthorization).toBe('enforced');
  });

  it('shares installation-token cleanup with the direct and composed processors', async () => {
    const deleteSecrets = vi.fn(() => Promise.resolve(1));
    const provider = createGithubIntegrationProvider({
      github: {} as never,
      getExistingGithubConnection: vi.fn(() => Promise.resolve(undefined)),
      connectGithubInstallation: vi.fn() as never,
      coreDb: vi.fn() as never,
      publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: false})),
      publishSourceRepositoryUpdated: vi.fn(() => Promise.resolve({published: false})),
      publishSourcePush: vi.fn(() => Promise.resolve({published: false})),
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(undefined)),
      deleteSecrets,
      checkoutTokenCache: {getOrMint: vi.fn()},
    });
    expect(provider.eventCatalog).toBe(githubEventCatalog);
    const deleteConnectionSecrets = provider.deleteConnectionSecrets;
    expect(deleteConnectionSecrets).toBeDefined();
    if (!deleteConnectionSecrets) throw new Error('Expected connection secret cleanup');
    const connection = {
      id: 'connection-1',
      provider: 'github' as const,
      workspaceId: 'workspace-1',
      externalAccountId: '123',
      slug: 'github_shipfox',
      displayName: 'GitHub',
      lifecycleStatus: 'active' as const,
      repositoryAccessMode: 'selected' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const checkoutNamespace = githubCheckoutTokenNamespace(
      githubProviderInstanceFingerprint('https://api.github.com', '1'),
      123,
    );
    await deleteConnectionSecrets?.(connection);
    await deleteConnectionSecrets?.(connection);
    const deletedNamespaces = deleteSecrets.mock.calls as unknown as Array<
      [{workspaceId: string; namespace: string}]
    >;
    expect(deletedNamespaces.map(([params]) => params)).toEqual(
      expect.arrayContaining([
        {
          workspaceId: 'workspace-1',
          namespace: githubInstallationTokenNamespace(123),
        },
        {
          workspaceId: 'workspace-1',
          namespace: checkoutNamespace,
        },
        {
          workspaceId: 'workspace-1',
          namespace: githubInstallationTokenNamespace(123),
        },
        {
          workspaceId: 'workspace-1',
          namespace: checkoutNamespace,
        },
      ]),
    );

    await expect(
      deleteConnectionSecrets({...connection, externalAccountId: '0123'}),
    ).rejects.toThrow('Invalid GitHub installation id: 0123');
    await expect(
      deleteConnectionSecrets({...connection, externalAccountId: '+123'}),
    ).rejects.toThrow('Invalid GitHub installation id: +123');
    expect(deleteSecrets).toHaveBeenCalledTimes(4);

    const processorOptions = state.processorOptions as {
      deleteInstallationTokenSecret: (params: {
        workspaceId: string;
        installationId: number;
      }) => Promise<unknown>;
    };

    await processorOptions.deleteInstallationTokenSecret({
      workspaceId: 'workspace-1',
      installationId: 123,
    });

    expect(deleteSecrets).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      namespace: githubInstallationTokenNamespace(123),
    });
    expect(deleteSecrets).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      namespace: checkoutNamespace,
    });
  });

  it('uses the default installation token provider for installation namespace deletion', async () => {
    const deleteSecrets = vi.fn(() => Promise.resolve(1));
    const provider = createGithubIntegrationProvider({
      github: {} as never,
      getExistingGithubConnection: vi.fn(() => Promise.resolve(undefined)),
      connectGithubInstallation: vi.fn() as never,
      coreDb: vi.fn() as never,
      publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: false})),
      publishSourceRepositoryUpdated: vi.fn(() => Promise.resolve({published: false})),
      publishSourcePush: vi.fn(() => Promise.resolve({published: false})),
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(undefined)),
      deleteSecrets,
    });
    const defaultTokenProvider = provider.adapters.agent_tools as unknown as {
      tokenProvider: {deleteInstallation?: ReturnType<typeof vi.fn>};
    };
    const deleteInstallation = vi.fn(
      async (
        installationId: number,
        options?: {deleteNamespace?: (installationId: number) => Promise<number>},
      ) => (await options?.deleteNamespace?.(installationId)) ?? 1,
    );
    defaultTokenProvider.tokenProvider.deleteInstallation = deleteInstallation;

    const cleanup = state.processorOptions as {
      deleteInstallationTokenSecret: (params: {
        workspaceId: string;
        installationId: number;
      }) => Promise<unknown>;
    };
    await cleanup.deleteInstallationTokenSecret({workspaceId: 'workspace-1', installationId: 123});
    expect(deleteInstallation).toHaveBeenCalledWith(123, expect.any(Object));
    expect(deleteSecrets).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      namespace: githubInstallationTokenNamespace(123),
    });
  });

  it('passes installation namespace deletion through an injected token provider', async () => {
    const deleteSecrets = vi.fn(() => Promise.resolve(1));
    const deleteInstallation = vi.fn(
      async (
        installationId: number,
        options?: {
          workspaceId?: string;
          deleteNamespace?: (installationId: number) => Promise<number>;
        },
      ) => {
        return (await options?.deleteNamespace?.(installationId)) ?? 1;
      },
    );
    const provider = createGithubIntegrationProvider({
      github: {} as never,
      getExistingGithubConnection: vi.fn(() => Promise.resolve(undefined)),
      connectGithubInstallation: vi.fn() as never,
      coreDb: vi.fn() as never,
      publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: false})),
      publishSourceRepositoryUpdated: vi.fn(() => Promise.resolve({published: false})),
      publishSourcePush: vi.fn(() => Promise.resolve({published: false})),
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(undefined)),
      deleteSecrets,
      agentTools: {
        tokenProvider: {
          getInstallationAccessToken: vi.fn(),
          deleteInstallation,
        },
      },
    });

    const processorOptions = state.processorOptions as {
      deleteInstallationTokenSecret: (params: {
        workspaceId: string;
        installationId: number;
      }) => Promise<unknown>;
    };
    await processorOptions.deleteInstallationTokenSecret({
      workspaceId: 'workspace-1',
      installationId: 123,
    });

    expect(deleteInstallation).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        workspaceId: 'workspace-1',
        deleteNamespace: expect.any(Function),
      }),
    );
    expect(deleteSecrets).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      namespace: githubInstallationTokenNamespace(123),
    });

    expect(
      (
        provider.adapters.agent_tools as unknown as {
          tokenProvider: {deleteInstallation?: unknown};
        }
      ).tokenProvider.deleteInstallation,
    ).toBe(deleteInstallation);
  });

  it('uses the exact cache lifecycle for installation cleanup when it is available', async () => {
    const deleteSecrets = vi.fn(() => Promise.resolve(1));
    const deleteInstallation = vi.fn(() => Promise.resolve(1));
    const provider = createGithubIntegrationProvider({
      github: {} as never,
      getExistingGithubConnection: vi.fn(() => Promise.resolve(undefined)),
      connectGithubInstallation: vi.fn() as never,
      coreDb: vi.fn() as never,
      publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: false})),
      publishSourceRepositoryUpdated: vi.fn(() => Promise.resolve({published: false})),
      publishSourcePush: vi.fn(() => Promise.resolve({published: false})),
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(undefined)),
      deleteSecrets,
      checkoutTokenCache: {getOrMint: vi.fn(), deleteInstallation},
    });
    const deleteConnectionSecrets = provider.deleteConnectionSecrets;
    if (!deleteConnectionSecrets) throw new Error('Expected connection secret cleanup');

    await deleteConnectionSecrets({
      id: 'connection-1',
      provider: 'github',
      workspaceId: 'workspace-1',
      externalAccountId: '123',
      slug: 'github_shipfox',
      displayName: 'GitHub',
      lifecycleStatus: 'active',
      repositoryAccessMode: 'selected',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(deleteInstallation).toHaveBeenCalledWith(
      'workspace-1',
      githubProviderInstanceFingerprint('https://api.github.com', '1'),
      123,
    );
    expect(deleteSecrets).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      namespace: githubInstallationTokenNamespace(123),
    });
  });

  it('falls back to namespace deletion when a cache cannot delete shared entries', async () => {
    const deleteSecrets = vi.fn(() => Promise.resolve(1));
    const deleteInstallation = vi.fn(() => Promise.resolve(0));
    const provider = createGithubIntegrationProvider({
      github: {} as never,
      getExistingGithubConnection: vi.fn(() => Promise.resolve(undefined)),
      connectGithubInstallation: vi.fn() as never,
      coreDb: vi.fn() as never,
      publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: false})),
      publishSourceRepositoryUpdated: vi.fn(() => Promise.resolve({published: false})),
      publishSourcePush: vi.fn(() => Promise.resolve({published: false})),
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(undefined)),
      deleteSecrets,
      checkoutTokenCache: {getOrMint: vi.fn(), deleteInstallation},
    });
    const deleteConnectionSecrets = provider.deleteConnectionSecrets;
    if (!deleteConnectionSecrets) throw new Error('Expected connection secret cleanup');

    await deleteConnectionSecrets({
      id: 'connection-1',
      provider: 'github',
      workspaceId: 'workspace-1',
      externalAccountId: '123',
      slug: 'github_shipfox',
      displayName: 'GitHub',
      lifecycleStatus: 'active',
      repositoryAccessMode: 'selected',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(deleteInstallation).toHaveBeenCalledOnce();
    expect(deleteSecrets).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      namespace: githubCheckoutTokenNamespace(
        githubProviderInstanceFingerprint('https://api.github.com', '1'),
        123,
      ),
    });
  });

  it('supports cache-only installation cleanup when shared deletion is unavailable', async () => {
    const deleteInstallation = vi.fn(() => Promise.resolve(1));
    const provider = createGithubIntegrationProvider({
      github: {} as never,
      getExistingGithubConnection: vi.fn(() => Promise.resolve(undefined)),
      connectGithubInstallation: vi.fn() as never,
      coreDb: vi.fn() as never,
      publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: false})),
      publishSourceRepositoryUpdated: vi.fn(() => Promise.resolve({published: false})),
      publishSourcePush: vi.fn(() => Promise.resolve({published: false})),
      recordDeliveryOnly: vi.fn(() => Promise.resolve()),
      getIntegrationConnectionById: vi.fn(() => Promise.resolve(undefined)),
      checkoutTokenCache: {getOrMint: vi.fn(), deleteInstallation},
    });
    const deleteConnectionSecrets = provider.deleteConnectionSecrets;
    if (!deleteConnectionSecrets) throw new Error('Expected connection secret cleanup');

    await deleteConnectionSecrets({
      id: 'connection-1',
      provider: 'github',
      workspaceId: 'workspace-1',
      externalAccountId: '123',
      slug: 'github_shipfox',
      displayName: 'GitHub',
      lifecycleStatus: 'active',
      repositoryAccessMode: 'selected',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(deleteInstallation).toHaveBeenCalledWith(
      'workspace-1',
      githubProviderInstanceFingerprint('https://api.github.com', '1'),
      123,
    );
  });
});
