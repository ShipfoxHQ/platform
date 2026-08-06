import {
  getJiraInstallationByConnectionId,
  upsertJiraInstallation,
} from '@shipfox/api-integration-jira';
import {runMigrations} from '@shipfox/node-drizzle';
import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';
import {db} from '#db/db.js';
import {createTestApp, useIntegrationRouteTest} from '#test/route-utils.js';

describe('jiraProviderModule', () => {
  const context = useIntegrationRouteTest();

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('loads its database descriptor and persists a core connection with its Jira installation', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_JIRA_PROVIDER', 'true');
    vi.resetModules();
    const {createPostgresClient} = await import('@shipfox/node-postgres');
    createPostgresClient();
    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules();
    const jiraPart = parts.find((part) => part.provider.provider === 'jira');
    if (!jiraPart?.database) throw new Error('Jira provider database is not configured');
    expect(jiraPart.provider.routes).toHaveLength(2);
    expect(jiraPart.workers).toEqual([
      expect.objectContaining({taskQueue: 'integrations-jira-maintenance'}),
    ]);
    expect(jiraPart.webhookProcessors).toEqual([expect.objectContaining({routeIds: ['jira']})]);
    const workspaceId = crypto.randomUUID();
    const cloudId = crypto.randomUUID();

    await runMigrations(
      jiraPart.database.db(),
      jiraPart.database.migrationsPath,
      `__drizzle_migrations_${jiraPart.database.databaseNamespace}`,
    );
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'jira',
      externalAccountId: cloudId,
      slug: `jira_${cloudId}`,
      displayName: 'Jira Acme',
    });
    await upsertJiraInstallation({
      connectionId: connection.id,
      cloudId,
      siteUrl: 'https://acme.atlassian.net',
      siteName: 'Acme',
      authorizingAccountId: crypto.randomUUID(),
      scopes: ['read:jira-work'],
      status: 'installed',
    });

    await expect(getIntegrationConnectionById(connection.id)).resolves.toMatchObject({
      id: connection.id,
      provider: 'jira',
    });
    await expect(getJiraInstallationByConnectionId(connection.id)).resolves.toMatchObject({
      connectionId: connection.id,
      cloudId,
    });
  });

  it('deletes the installation and tokens through the generic route before allowing a reinstall', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_JIRA_PROVIDER', 'true');
    vi.resetModules();
    const deleteSecrets = vi.fn(() => Promise.resolve(2));
    const scopedSecrets = {
      getSecret: vi.fn(() => Promise.resolve(null)),
      setSecrets: vi.fn(() => Promise.resolve()),
      deleteSecrets,
    };
    const {createPostgresClient} = await import('@shipfox/node-postgres');
    createPostgresClient();
    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules({
      secrets: {jira: scopedSecrets, deleteSecrets},
    });
    const jiraPart = parts.find((part) => part.provider.provider === 'jira');
    if (!jiraPart?.database) throw new Error('Jira provider database is not configured');
    const cloudId = crypto.randomUUID();

    await runMigrations(
      jiraPart.database.db(),
      jiraPart.database.migrationsPath,
      `__drizzle_migrations_${jiraPart.database.databaseNamespace}`,
    );
    const app = await createTestApp([jiraPart.provider]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'jira',
      externalAccountId: cloudId,
      slug: 'jira_acme',
      displayName: 'Jira Acme',
    });
    await upsertJiraInstallation({
      connectionId: connection.id,
      cloudId,
      siteUrl: 'https://acme.atlassian.net',
      siteName: 'Acme',
      authorizingAccountId: 'user-1',
      scopes: ['read:jira-work'],
      status: 'installed',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
    await expect(getJiraInstallationByConnectionId(connection.id)).resolves.toBeUndefined();
    expect(deleteSecrets).toHaveBeenCalledWith({
      workspaceId: context.workspaceId,
      namespace: connection.id,
    });

    const replacement = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'jira',
      externalAccountId: cloudId,
      slug: 'jira_acme_again',
      displayName: 'Jira Acme',
    });
    await upsertJiraInstallation({
      connectionId: replacement.id,
      cloudId,
      siteUrl: 'https://acme.atlassian.net',
      siteName: 'Acme',
      authorizingAccountId: 'user-1',
      scopes: ['read:jira-work'],
      status: 'installed',
    });

    await expect(getJiraInstallationByConnectionId(replacement.id)).resolves.toMatchObject({
      cloudId,
    });
  });

  it('rolls back provider record cleanup when its transaction fails', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_JIRA_PROVIDER', 'true');
    vi.resetModules();
    const deleteSecrets = vi.fn(() => Promise.resolve(2));
    const scopedSecrets = {
      getSecret: vi.fn(() => Promise.resolve(null)),
      setSecrets: vi.fn(() => Promise.resolve()),
      deleteSecrets,
    };
    const {createPostgresClient} = await import('@shipfox/node-postgres');
    createPostgresClient();
    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules({
      secrets: {jira: scopedSecrets, deleteSecrets},
    });
    const jiraPart = parts.find((part) => part.provider.provider === 'jira');
    if (!jiraPart?.database) throw new Error('Jira provider database is not configured');
    const cloudId = crypto.randomUUID();

    await runMigrations(
      jiraPart.database.db(),
      jiraPart.database.migrationsPath,
      `__drizzle_migrations_${jiraPart.database.databaseNamespace}`,
    );
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'jira',
      externalAccountId: cloudId,
      slug: 'jira_acme',
      displayName: 'Jira Acme',
    });
    await upsertJiraInstallation({
      connectionId: connection.id,
      cloudId,
      siteUrl: 'https://acme.atlassian.net',
      siteName: 'Acme',
      authorizingAccountId: 'user-1',
      scopes: ['read:jira-work'],
      status: 'installed',
    });

    await expect(
      db().transaction(async (tx) => {
        await jiraPart.provider.deleteConnectionRecords?.(connection, {tx});
        throw new Error('transaction failed');
      }),
    ).rejects.toThrow('transaction failed');

    await expect(getIntegrationConnectionById(connection.id)).resolves.toMatchObject({
      id: connection.id,
    });
    await expect(getJiraInstallationByConnectionId(connection.id)).resolves.toMatchObject({
      connectionId: connection.id,
    });
    expect(deleteSecrets).not.toHaveBeenCalled();
  });
});
