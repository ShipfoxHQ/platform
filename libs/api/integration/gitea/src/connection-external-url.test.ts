import type {GiteaApiClient} from '#api/client.js';
import {createGiteaIntegrationProvider} from '#index.js';

function giteaClient(): GiteaApiClient {
  return {
    listOrgRepositories: vi.fn(() => Promise.reject(new Error('not used'))),
    getRepository: vi.fn(() => Promise.reject(new Error('not used'))),
    resolveRef: vi.fn(() => Promise.reject(new Error('not used'))),
    getBranch: vi.fn(() => Promise.reject(new Error('not used'))),
    getTag: vi.fn(() => Promise.reject(new Error('not used'))),
    listTree: vi.fn(() => Promise.reject(new Error('not used'))),
    fetchFileContent: vi.fn(() => Promise.reject(new Error('not used'))),
    organizationExists: vi.fn(() => Promise.reject(new Error('not used'))),
  };
}

function createProvider() {
  return createGiteaIntegrationProvider({
    gitea: giteaClient(),
    getExistingGiteaConnection: vi.fn(() => Promise.resolve(undefined)),
    connectGiteaConnection: vi.fn() as never,
    // Provider-level mounting includes webhook routes; this test exercises only URLs.
    coreDb: vi.fn() as never,
    publishSourcePush: vi.fn() as never,
    recordDeliveryOnly: vi.fn() as never,
    getIntegrationConnectionById: vi.fn() as never,
  });
}

describe('gitea connectionExternalUrl', () => {
  it('points at the org page on the configured Gitea instance', async () => {
    const provider = createProvider();

    const url = await provider.connectionExternalUrl({externalAccountId: 'shipfox'});

    expect(url).toBe('https://gitea.example.com/shipfox');
  });
});
