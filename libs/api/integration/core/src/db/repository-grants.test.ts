import {upsertIntegrationConnection} from './connections.js';
import {
  deleteIntegrationConnectionRepositoryGrant,
  getIntegrationConnectionRepositoryGrant,
  listIntegrationConnectionRepositoryGrants,
  listIntegrationConnectionRepositoryGrantsByName,
  updateIntegrationConnectionRepositoryGrantMetadata,
  upsertIntegrationConnectionRepositoryGrant,
} from './repository-grants.js';

describe('integration connection repository grant queries', () => {
  it('upserts by connection and provider-namespaced repository id', async () => {
    const workspaceId = crypto.randomUUID();
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: `github-${crypto.randomUUID()}`,
      slug: `github_${crypto.randomUUID()}`,
      displayName: 'GitHub',
      capabilities: ['source_control'],
    });

    const first = await upsertIntegrationConnectionRepositoryGrant({
      connectionId: connection.id,
      externalRepositoryId: 'github:42',
      repositoryOwner: 'Acme',
      repositoryName: 'Platform',
    });
    const repeated = await upsertIntegrationConnectionRepositoryGrant({
      connectionId: connection.id,
      externalRepositoryId: 'github:42',
      repositoryOwner: 'acme',
      repositoryName: 'platform-renamed',
    });

    expect(first).toBeDefined();
    expect(repeated?.id).toBe(first?.id);
    expect(repeated?.workspaceId).toBe(workspaceId);
    expect(repeated).toMatchObject({
      connectionId: connection.id,
      externalRepositoryId: 'github:42',
      repositoryOwner: 'acme',
      repositoryName: 'platform-renamed',
    });
    expect(
      await listIntegrationConnectionRepositoryGrants({connectionId: connection.id}),
    ).toHaveLength(1);
  });

  it('keeps grants scoped to their connection while deriving workspace ownership', async () => {
    const firstWorkspaceId = crypto.randomUUID();
    const secondWorkspaceId = crypto.randomUUID();
    const firstConnection = await upsertIntegrationConnection({
      workspaceId: firstWorkspaceId,
      provider: 'github',
      externalAccountId: `github-${crypto.randomUUID()}`,
      slug: `github_${crypto.randomUUID()}`,
      displayName: 'GitHub one',
      capabilities: ['source_control'],
    });
    const secondConnection = await upsertIntegrationConnection({
      workspaceId: secondWorkspaceId,
      provider: 'github',
      externalAccountId: `github-${crypto.randomUUID()}`,
      slug: `github_${crypto.randomUUID()}`,
      displayName: 'GitHub two',
      capabilities: ['source_control'],
    });

    const firstGrant = await upsertIntegrationConnectionRepositoryGrant({
      connectionId: firstConnection.id,
      externalRepositoryId: 'github:42',
      repositoryOwner: 'Acme',
      repositoryName: 'Platform',
    });
    const secondGrant = await upsertIntegrationConnectionRepositoryGrant({
      connectionId: secondConnection.id,
      externalRepositoryId: 'github:42',
      repositoryOwner: 'Acme',
      repositoryName: 'Platform',
    });

    expect(firstGrant?.workspaceId).toBe(firstWorkspaceId);
    expect(secondGrant?.workspaceId).toBe(secondWorkspaceId);
    expect(secondGrant?.id).not.toBe(firstGrant?.id);
    expect(
      await getIntegrationConnectionRepositoryGrant({
        connectionId: firstConnection.id,
        externalRepositoryId: 'github:42',
      }),
    ).toMatchObject({id: firstGrant?.id, workspaceId: firstWorkspaceId});
  });

  it('supports case-insensitive name lookup and signed metadata refresh', async () => {
    const connection = await upsertIntegrationConnection({
      workspaceId: crypto.randomUUID(),
      provider: 'github',
      externalAccountId: `github-${crypto.randomUUID()}`,
      slug: `github_${crypto.randomUUID()}`,
      displayName: 'GitHub',
      capabilities: ['source_control'],
    });
    const grant = await upsertIntegrationConnectionRepositoryGrant({
      connectionId: connection.id,
      externalRepositoryId: 'github:42',
      repositoryOwner: 'Acme',
      repositoryName: 'Platform',
    });
    if (!grant) throw new Error('Expected repository grant');

    const updated = await updateIntegrationConnectionRepositoryGrantMetadata({
      connectionId: connection.id,
      externalRepositoryId: 'github:42',
      repositoryOwner: 'acme',
      repositoryName: 'Platform-Renamed',
    });

    expect(updated).toMatchObject({
      id: grant.id,
      repositoryOwner: 'acme',
      repositoryName: 'Platform-Renamed',
    });
    await expect(
      listIntegrationConnectionRepositoryGrantsByName({
        connectionId: connection.id,
        repositoryOwner: 'ACME',
        repositoryName: 'platform-renamed',
      }),
    ).resolves.toMatchObject([{id: grant.id}]);
  });

  it('deletes a grant by connection and external repository id', async () => {
    const connection = await upsertIntegrationConnection({
      workspaceId: crypto.randomUUID(),
      provider: 'github',
      externalAccountId: `github-${crypto.randomUUID()}`,
      slug: `github_${crypto.randomUUID()}`,
      displayName: 'GitHub',
      capabilities: ['source_control'],
    });
    await upsertIntegrationConnectionRepositoryGrant({
      connectionId: connection.id,
      externalRepositoryId: 'github:42',
      repositoryOwner: 'acme',
      repositoryName: 'platform',
    });

    expect(
      await deleteIntegrationConnectionRepositoryGrant({
        connectionId: connection.id,
        externalRepositoryId: 'github:42',
      }),
    ).toBe(true);
    expect(
      await deleteIntegrationConnectionRepositoryGrant({
        connectionId: connection.id,
        externalRepositoryId: 'github:42',
      }),
    ).toBe(false);
    expect(
      await listIntegrationConnectionRepositoryGrants({connectionId: connection.id}),
    ).toHaveLength(0);
  });

  it('does not create a grant for an unknown connection', async () => {
    await expect(
      upsertIntegrationConnectionRepositoryGrant({
        connectionId: crypto.randomUUID(),
        externalRepositoryId: 'github:42',
        repositoryOwner: 'acme',
        repositoryName: 'platform',
      }),
    ).resolves.toBeUndefined();
  });
});
