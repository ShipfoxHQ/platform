import {listIntegrationConnections, upsertIntegrationConnection} from './connections.js';

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
      capabilities: ['source_control'],
    });

    const second = await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      displayName: 'Renamed Debug Source Control',
      capabilities: ['source_control'],
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
      capabilities: ['source_control'],
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug-2',
      displayName: 'Debug Two',
      capabilities: ['source_control'],
    });

    const result = await listIntegrationConnections({workspaceId});

    expect(result).toHaveLength(2);
  });

  it('lists only active connections matching the requested capability', async () => {
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      displayName: 'Debug Source Control',
      capabilities: ['source_control'],
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: 'team-1',
      displayName: 'GitHub',
      capabilities: [],
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: 'installation-1',
      displayName: 'GitHub',
      lifecycleStatus: 'disabled',
      capabilities: ['source_control'],
    });

    const result = await listIntegrationConnections({workspaceId, capability: 'source_control'});

    expect(result.map((connection) => connection.provider)).toEqual(['debug']);
  });
});
