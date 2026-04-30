import {upsertGithubInstallation} from '@shipfox/api-integration-github';
import {listIntegrationConnections, upsertIntegrationConnection} from './connections.js';
import {db} from './db.js';

describe('integration connection queries', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('upserts duplicate external connections for a workspace', async () => {
    const first = await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      displayName: 'Debug Source Control',
    });

    const second = await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      displayName: 'Renamed Debug Source Control',
    });

    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe('Renamed Debug Source Control');
  });

  it('allows multiple same-provider connections when external account differs', async () => {
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug-1',
      displayName: 'Debug One',
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug-2',
      displayName: 'Debug Two',
    });

    const result = await listIntegrationConnections({workspaceId});

    expect(result).toHaveLength(2);
  });

  it('lists only active connections for a workspace', async () => {
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      displayName: 'Debug Source Control',
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: 'team-1',
      displayName: 'GitHub',
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: 'installation-1',
      displayName: 'GitHub',
      lifecycleStatus: 'disabled',
    });

    const result = await listIntegrationConnections({workspaceId});

    expect(result.map((connection) => connection.provider)).toEqual(['debug', 'github']);
  });

  it('rolls back a connection when provider-specific installation persistence fails', async () => {
    const result = db().transaction(async (tx) => {
      const connection = await upsertIntegrationConnection(
        {
          workspaceId,
          provider: 'github',
          externalAccountId: '123',
          displayName: 'GitHub shipfox',
        },
        {tx},
      );

      await upsertGithubInstallation(
        {
          connectionId: connection.id,
          installationId: '123',
          accountLogin: null as unknown as string,
          accountType: 'Organization',
          repositorySelection: 'all',
          latestEvent: {id: 123},
        },
        {tx},
      );
    });

    await expect(result).rejects.toThrow();

    const connections = await listIntegrationConnections({workspaceId});
    expect(connections).toHaveLength(0);
  });
});
