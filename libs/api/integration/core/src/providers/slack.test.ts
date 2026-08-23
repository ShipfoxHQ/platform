import {
  getSlackInstallationByConnectionId,
  upsertSlackInstallation,
} from '@shipfox/api-integration-slack';
import {runMigrations} from '@shipfox/node-drizzle';
import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';
import {db} from '#db/db.js';
import {createTestApp, useIntegrationRouteTest} from '#test/route-utils.js';

describe('slackProviderModule', () => {
  const context = useIntegrationRouteTest();

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('loads its database descriptor and persists a core connection with its Slack installation', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_SLACK_PROVIDER', 'true');
    vi.resetModules();
    const {createPostgresClient} = await import('@shipfox/node-postgres');
    createPostgresClient();
    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules();
    const slackPart = parts.find((part) => part.provider.provider === 'slack');
    if (!slackPart?.database) throw new Error('Slack provider database is not configured');
    const workspaceId = crypto.randomUUID();
    const teamId = `T${crypto.randomUUID()}`;

    await runMigrations(
      slackPart.database.db(),
      slackPart.database.migrationsPath,
      `__drizzle_migrations_${slackPart.database.databaseNamespace}`,
    );
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'slack',
      externalAccountId: teamId,
      slug: `slack_${teamId}`,
      displayName: 'Slack Acme',
      capabilities: ['agent_tools'],
    });
    await upsertSlackInstallation({
      connectionId: connection.id,
      teamId,
      teamName: 'Acme',
      appId: 'A123',
      botUserId: 'U123',
      scopes: ['app_mentions:read'],
      status: 'installed',
    });

    await expect(getIntegrationConnectionById(connection.id)).resolves.toMatchObject({
      id: connection.id,
      provider: 'slack',
    });
    await expect(getSlackInstallationByConnectionId(connection.id)).resolves.toMatchObject({
      connectionId: connection.id,
      teamId,
    });
  });

  it('deletes the installation and token through the generic route before allowing a reinstall', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_SLACK_PROVIDER', 'true');
    vi.resetModules();
    const deleteSecrets = vi.fn(() => Promise.resolve(1));
    const scopedSecrets = {
      getSecret: vi.fn(() => Promise.resolve(null)),
      setSecrets: vi.fn(() => Promise.resolve()),
      deleteSecrets,
    };
    const {createPostgresClient} = await import('@shipfox/node-postgres');
    createPostgresClient();
    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules({
      secrets: {slack: scopedSecrets, deleteSecrets},
    });
    const slackPart = parts.find((part) => part.provider.provider === 'slack');
    if (!slackPart?.database) throw new Error('Slack provider database is not configured');
    const teamId = `T${crypto.randomUUID()}`;

    await runMigrations(
      slackPart.database.db(),
      slackPart.database.migrationsPath,
      `__drizzle_migrations_${slackPart.database.databaseNamespace}`,
    );
    const app = await createTestApp([slackPart.provider]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: teamId,
      slug: `slack_${teamId}`,
      displayName: 'Slack Acme',
      capabilities: ['agent_tools'],
    });
    await upsertSlackInstallation({
      connectionId: connection.id,
      teamId,
      teamName: 'Acme',
      appId: 'A123',
      botUserId: 'U123',
      scopes: ['app_mentions:read'],
      status: 'installed',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
    await expect(getSlackInstallationByConnectionId(connection.id)).resolves.toBeUndefined();
    expect(deleteSecrets).toHaveBeenCalledWith({
      workspaceId: context.workspaceId,
      namespace: connection.id,
    });

    const replacement = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: teamId,
      slug: `slack_${teamId}_again`,
      displayName: 'Slack Acme',
      capabilities: ['agent_tools'],
    });
    await upsertSlackInstallation({
      connectionId: replacement.id,
      teamId,
      teamName: 'Acme',
      appId: 'A123',
      botUserId: 'U123',
      scopes: ['app_mentions:read'],
      status: 'installed',
    });

    await expect(getSlackInstallationByConnectionId(replacement.id)).resolves.toMatchObject({
      teamId,
    });
  });

  it('rolls back provider record cleanup when its transaction fails', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_SLACK_PROVIDER', 'true');
    vi.resetModules();
    const deleteSecrets = vi.fn(() => Promise.resolve(1));
    const scopedSecrets = {
      getSecret: vi.fn(() => Promise.resolve(null)),
      setSecrets: vi.fn(() => Promise.resolve()),
      deleteSecrets,
    };
    const {createPostgresClient} = await import('@shipfox/node-postgres');
    createPostgresClient();
    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules({
      secrets: {slack: scopedSecrets, deleteSecrets},
    });
    const slackPart = parts.find((part) => part.provider.provider === 'slack');
    if (!slackPart?.database) throw new Error('Slack provider database is not configured');
    const teamId = `T${crypto.randomUUID()}`;

    await runMigrations(
      slackPart.database.db(),
      slackPart.database.migrationsPath,
      `__drizzle_migrations_${slackPart.database.databaseNamespace}`,
    );
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: teamId,
      slug: `slack_${teamId}`,
      displayName: 'Slack Acme',
      capabilities: ['agent_tools'],
    });
    await upsertSlackInstallation({
      connectionId: connection.id,
      teamId,
      teamName: 'Acme',
      appId: 'A123',
      botUserId: 'U123',
      scopes: ['app_mentions:read'],
      status: 'installed',
    });

    await expect(
      db().transaction(async (tx) => {
        await slackPart.provider.deleteConnectionRecords?.(connection, {tx});
        throw new Error('transaction failed');
      }),
    ).rejects.toThrow('transaction failed');

    await expect(getIntegrationConnectionById(connection.id)).resolves.toMatchObject({
      id: connection.id,
    });
    await expect(getSlackInstallationByConnectionId(connection.id)).resolves.toMatchObject({
      connectionId: connection.id,
    });
    expect(deleteSecrets).not.toHaveBeenCalled();
  });
});
