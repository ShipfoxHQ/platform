import {INTEGRATION_CONNECTION_AVAILABLE} from '@shipfox/api-integration-core-dto';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {integrationConnections} from '#db/schema/connections.js';
import {integrationsOutbox} from '#db/schema/outbox.js';

describe('loadEnabledProviderModules', () => {
  afterEach(async () => {
    await closeApp();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('loads cron alongside webhook by default', async () => {
    vi.resetModules();

    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules();

    expect(parts.map((part) => part.provider.provider)).toEqual(['cron', 'webhook']);
  });

  it('does not load cron when the provider is disabled', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_CRON_PROVIDER', 'false');
    vi.resetModules();

    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules();

    expect(parts.map((part) => part.provider.provider)).toEqual(['webhook']);
  });

  it('loads Linear when the provider is enabled', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_LINEAR_PROVIDER', 'true');
    vi.resetModules();

    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules();

    expect(parts.map((part) => part.provider.provider)).toEqual(['linear', 'cron', 'webhook']);
    expect(parts[0]?.provider).toMatchObject({
      provider: 'linear',
      displayName: 'Linear',
      adapters: {},
    });
  });

  it('loads Slack when the provider is enabled', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_SLACK_PROVIDER', 'true');
    vi.resetModules();

    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules();

    expect(parts.map((part) => part.provider.provider)).toEqual(['slack', 'cron', 'webhook']);
    expect(parts[0]?.provider).toMatchObject({
      provider: 'slack',
      displayName: 'Slack',
    });
    expect(parts[0]?.provider.adapters?.agent_tools).toBeDefined();
  });

  it('loads Jira when the provider is enabled', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_JIRA_PROVIDER', 'true');
    vi.resetModules();

    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules();

    expect(parts.map((part) => part.provider.provider)).toEqual(['jira', 'cron', 'webhook']);
    expect(parts[0]?.provider).toMatchObject({provider: 'jira', displayName: 'Jira'});
  });

  it('publishes registry-derived capabilities for a GitHub connect flow', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_GITHUB_PROVIDER', 'true');
    vi.resetModules();

    const {createPostgresClient} = await import('@shipfox/node-postgres');
    createPostgresClient();
    const {loadEnabledProviderModules} = await import('#providers/modules.js');
    const parts = await loadEnabledProviderModules();
    const githubPart = parts.find((part) => part.provider.provider === 'github');
    if (!githubPart?.e2eRoutes) throw new Error('GitHub E2E routes are not configured');

    const workspaceId = crypto.randomUUID();
    const installationId = Number.parseInt(crypto.randomUUID().replaceAll('-', '').slice(0, 8), 16);
    try {
      const app = await createApp({routes: githubPart.e2eRoutes, swagger: false});
      const response = await app.inject({
        method: 'POST',
        url: '/integrations/github-connections',
        payload: {
          workspace_id: workspaceId,
          installation_id: installationId,
          account_login: 'shipfox-e2e',
          display_name: 'GitHub E2E',
          installer_user_id: crypto.randomUUID(),
        },
      });
      const connection = response.json();

      expect(response.statusCode).toBe(201);
      expect(connection).toMatchObject({id: expect.any(String)});

      const [event] = await db()
        .select({payload: integrationsOutbox.payload})
        .from(integrationsOutbox)
        .where(
          sql`${integrationsOutbox.eventType} = ${INTEGRATION_CONNECTION_AVAILABLE} AND ${integrationsOutbox.payload}->>'connectionId' = ${connection.id}`,
        );

      expect(event?.payload).toEqual({
        provider: 'github',
        workspaceId,
        connectionId: connection.id,
        slug: 'github_shipfox_e2e',
        capabilities: ['source_control', 'agent_tools'],
      });
    } finally {
      await db()
        .delete(integrationsOutbox)
        .where(sql`${integrationsOutbox.payload}->>'workspaceId' = ${workspaceId}`);
      await db()
        .delete(integrationConnections)
        .where(eq(integrationConnections.workspaceId, workspaceId));
    }
  });
});
