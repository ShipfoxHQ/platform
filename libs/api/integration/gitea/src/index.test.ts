import {createGiteaIntegrationProvider, GiteaSourceControlProvider} from '#index.js';

describe('createGiteaIntegrationProvider', () => {
  it('exposes the gitea source-control adapter and the connection + webhook route groups', () => {
    const provider = createGiteaIntegrationProvider({
      getExistingGiteaConnection: vi.fn(() => Promise.resolve(undefined)),
      connectGiteaConnection: vi.fn() as never,
      coreDb: vi.fn() as never,
      publishSourcePush: vi.fn() as never,
      recordDeliveryOnly: vi.fn() as never,
      getIntegrationConnectionById: vi.fn() as never,
    });

    expect(provider.provider).toBe('gitea');
    expect(provider.displayName).toBe('Gitea');
    expect(provider.eventCatalog?.events.map((event) => event.name)).toEqual(['push']);
    expect(provider.adapters.source_control).toBeInstanceOf(GiteaSourceControlProvider);
    expect(provider.routes).toHaveLength(2);
    expect(provider.routes.map((group) => group.prefix)).toEqual([
      '/integrations/gitea',
      '/webhooks/integrations/gitea',
    ]);
  });
});
