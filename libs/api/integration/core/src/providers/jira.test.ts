import {
  getJiraInstallationByConnectionId,
  upsertJiraInstallation,
} from '@shipfox/api-integration-jira';
import {runMigrations} from '@shipfox/node-drizzle';
import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';

describe('jiraProviderModule', () => {
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
});
