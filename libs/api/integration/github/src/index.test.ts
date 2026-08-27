import {githubEventCatalog} from '@shipfox/api-integration-github-dto';
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
    });
    expect(provider.eventCatalog).toBe(githubEventCatalog);
    const deleteConnectionSecrets = provider.deleteConnectionSecrets;
    expect(deleteConnectionSecrets).toBeDefined();
    const connection = {
      id: 'connection-1',
      provider: 'github' as const,
      workspaceId: 'workspace-1',
      externalAccountId: '123',
      slug: 'github_shipfox',
      displayName: 'GitHub',
      lifecycleStatus: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await deleteConnectionSecrets?.(connection);
    await deleteConnectionSecrets?.(connection);
    expect(deleteSecrets).toHaveBeenNthCalledWith(1, {
      workspaceId: 'workspace-1',
      namespace: githubInstallationTokenNamespace(123),
    });
    expect(deleteSecrets).toHaveBeenNthCalledWith(2, {
      workspaceId: 'workspace-1',
      namespace: githubInstallationTokenNamespace(123),
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

    expect(deleteSecrets).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      namespace: githubInstallationTokenNamespace(123),
    });
  });
});
