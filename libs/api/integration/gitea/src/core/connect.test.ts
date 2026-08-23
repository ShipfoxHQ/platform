import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {GiteaApiClient} from '#api/client.js';
import {handleGiteaConnect} from '#core/connect.js';
import {GiteaOrgAlreadyLinkedError, GiteaOrganizationNotFoundError} from '#core/errors.js';

function giteaClient(overrides: Partial<GiteaApiClient> = {}): GiteaApiClient {
  return {
    listOrgRepositories: vi.fn(() => Promise.reject(new Error('not used'))),
    getRepository: vi.fn(() => Promise.reject(new Error('not used'))),
    resolveRef: vi.fn(() => Promise.reject(new Error('not used'))),
    getBranch: vi.fn(() => Promise.reject(new Error('not used'))),
    getTag: vi.fn(() => Promise.reject(new Error('not used'))),
    listTree: vi.fn(() => Promise.reject(new Error('not used'))),
    fetchFileContent: vi.fn(() => Promise.reject(new Error('not used'))),
    organizationExists: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

function connection(
  overrides: Partial<IntegrationConnection<'gitea'>> = {},
): IntegrationConnection<'gitea'> {
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
    ...overrides,
  };
}

describe('handleGiteaConnect', () => {
  it('rejects an org that does not exist on the Gitea instance', async () => {
    const gitea = giteaClient({organizationExists: vi.fn(() => Promise.resolve(false))});
    const connectGiteaConnection = vi.fn();

    const result = handleGiteaConnect({
      gitea,
      workspaceId: crypto.randomUUID(),
      org: 'ghost',
      getExistingGiteaConnection: vi.fn(() => Promise.resolve(undefined)),
      connectGiteaConnection,
    });

    await expect(result).rejects.toBeInstanceOf(GiteaOrganizationNotFoundError);
    expect(connectGiteaConnection).not.toHaveBeenCalled();
  });

  it('rejects an org already linked to another workspace', async () => {
    const gitea = giteaClient();
    const existing = connection({workspaceId: 'workspace-a'});
    const connectGiteaConnection = vi.fn();

    const result = handleGiteaConnect({
      gitea,
      workspaceId: 'workspace-b',
      org: 'shipfox',
      getExistingGiteaConnection: vi.fn(() => Promise.resolve(existing)),
      connectGiteaConnection,
    });

    await expect(result).rejects.toBeInstanceOf(GiteaOrgAlreadyLinkedError);
    expect(connectGiteaConnection).not.toHaveBeenCalled();
  });

  it('returns the existing active connection unchanged', async () => {
    const gitea = giteaClient();
    const workspaceId = crypto.randomUUID();
    const existing = connection({workspaceId, lifecycleStatus: 'active'});
    const connectGiteaConnection = vi.fn();

    const result = await handleGiteaConnect({
      gitea,
      workspaceId,
      org: 'shipfox',
      getExistingGiteaConnection: vi.fn(() => Promise.resolve(existing)),
      connectGiteaConnection,
    });

    expect(result).toBe(existing);
    expect(connectGiteaConnection).not.toHaveBeenCalled();
  });

  it('persists the connection for a new org', async () => {
    const gitea = giteaClient();
    const workspaceId = crypto.randomUUID();
    const connected = connection({workspaceId, externalAccountId: 'shipfox'});
    const connectGiteaConnection = vi.fn(() => Promise.resolve(connected));

    const result = await handleGiteaConnect({
      gitea,
      workspaceId,
      org: 'shipfox',
      getExistingGiteaConnection: vi.fn(() => Promise.resolve(undefined)),
      connectGiteaConnection,
    });

    expect(connectGiteaConnection).toHaveBeenCalledWith({
      workspaceId,
      org: 'shipfox',
      displayName: 'Gitea shipfox',
    });
    expect(result).toBe(connected);
  });

  it('canonicalizes org case so a case variant cannot bypass the cross-tenant guard', async () => {
    const gitea = giteaClient();
    const existing = connection({workspaceId: 'workspace-a', externalAccountId: 'acme'});
    const getExistingGiteaConnection = vi.fn(() => Promise.resolve(existing));
    const connectGiteaConnection = vi.fn();

    const result = handleGiteaConnect({
      gitea,
      workspaceId: 'workspace-b',
      org: 'Acme',
      getExistingGiteaConnection,
      connectGiteaConnection,
    });

    await expect(result).rejects.toBeInstanceOf(GiteaOrgAlreadyLinkedError);
    expect(gitea.organizationExists).toHaveBeenCalledWith({org: 'acme'});
    expect(getExistingGiteaConnection).toHaveBeenCalledWith({org: 'acme'});
    expect(connectGiteaConnection).not.toHaveBeenCalled();
  });

  it('persists the canonical lowercase org for a new connection', async () => {
    const gitea = giteaClient();
    const workspaceId = crypto.randomUUID();
    const connected = connection({workspaceId, externalAccountId: 'shipfox'});
    const connectGiteaConnection = vi.fn(() => Promise.resolve(connected));

    await handleGiteaConnect({
      gitea,
      workspaceId,
      org: 'ShipFox',
      getExistingGiteaConnection: vi.fn(() => Promise.resolve(undefined)),
      connectGiteaConnection,
    });

    expect(connectGiteaConnection).toHaveBeenCalledWith({
      workspaceId,
      org: 'shipfox',
      displayName: 'Gitea shipfox',
    });
  });
});
