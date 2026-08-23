import {INTEGRATION_CONNECTION_AVAILABLE} from '@shipfox/api-integration-core-dto';
import {upsertGithubInstallation} from '@shipfox/api-integration-github';
import {ConnectionSlugConflictError} from '@shipfox/api-integration-spi';
import {sql} from 'drizzle-orm';
import {IntegrationConnectionAlreadyExistsError} from '#core/errors.js';
import {
  createIntegrationConnection,
  deleteIntegrationConnection,
  getIntegrationConnectionById,
  getIntegrationConnectionBySlug,
  listIntegrationConnections,
  listIntegrationConnectionsByProvider,
  resolveUniqueConnectionSlug,
  updateIntegrationConnectionLifecycleStatus,
  upsertIntegrationConnection,
} from './connections.js';
import {db} from './db.js';
import {integrationsOutbox} from './schema/outbox.js';

function connectionEvents(connectionId: string) {
  return db()
    .select()
    .from(integrationsOutbox)
    .where(
      sql`${integrationsOutbox.eventType} = ${INTEGRATION_CONNECTION_AVAILABLE} AND ${integrationsOutbox.payload}->>'connectionId' = ${connectionId}`,
    );
}

describe('integration connection queries', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('upserts duplicate external connections for a workspace', async () => {
    const first = await upsertIntegrationConnection({
      workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });

    const second = await upsertIntegrationConnection({
      workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'debug_renamed',
      displayName: 'Renamed Debug',
      capabilities: ['source_control'],
    });

    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe('Renamed Debug');
    expect(second.slug).toBe('gitea_owner');
    expect(await connectionEvents(first.id)).toHaveLength(1);
  });

  it('publishes availability when an upsert activates an existing connection', async () => {
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'linear',
      externalAccountId: 'linear-acme',
      slug: 'linear_acme',
      displayName: 'Linear Acme',
      lifecycleStatus: 'disabled',
      capabilities: ['agent_tools'],
    });

    expect(await connectionEvents(connection.id)).toHaveLength(0);

    await upsertIntegrationConnection({
      workspaceId,
      provider: 'linear',
      externalAccountId: 'linear-acme',
      slug: 'linear_acme',
      displayName: 'Linear Acme',
      lifecycleStatus: 'active',
      capabilities: ['agent_tools'],
    });

    expect(await connectionEvents(connection.id)).toHaveLength(1);
  });

  it('allows multiple same-provider connections when external account differs', async () => {
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'gitea',
      externalAccountId: 'debug-1',
      slug: 'debug_1',
      displayName: 'Debug One',
      capabilities: ['source_control'],
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'gitea',
      externalAccountId: 'debug-2',
      slug: 'debug_2',
      displayName: 'Debug Two',
      capabilities: ['source_control'],
    });

    const result = await listIntegrationConnections({workspaceId});

    expect(result).toHaveLength(2);
  });

  it('resolves a connection by slug within its workspace', async () => {
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: 'debug-1',
      slug: 'github_main',
      displayName: 'GitHub',
      capabilities: ['source_control', 'agent_tools'],
    });

    await expect(
      getIntegrationConnectionBySlug({workspaceId, slug: 'github_main'}),
    ).resolves.toMatchObject({id: connection.id, slug: 'github_main'});
    await expect(
      getIntegrationConnectionBySlug({workspaceId: crypto.randomUUID(), slug: 'github_main'}),
    ).resolves.toBeUndefined();
  });

  it('resolves a unique slug in workspace scope', async () => {
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'gitea',
      externalAccountId: 'debug-1',
      slug: 'gitea_owner',
      displayName: 'Debug One',
      capabilities: ['source_control'],
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: 'debug-2',
      slug: 'debug_2',
      displayName: 'Debug Two',
      capabilities: ['source_control', 'agent_tools'],
    });

    const result = await resolveUniqueConnectionSlug({
      workspaceId,
      provider: 'gitea',
      externalAccountId: 'debug-3',
      baseSlug: 'debug',
    });

    expect(result).toBe('debug');
  });

  it.each([
    'github',
    'gitea',
    'sentry',
    'slack',
    'jira',
    'linear',
    'webhook',
  ] as const)('refuses the reserved source slugs for provider %s', async (provider) => {
    // Sync classifies a trigger source by literal: `manual` and `cron` are
    // built-in sources, never connection slugs, so every provider must refuse
    // to allocate them.
    for (const baseSlug of ['manual', 'cron'] as const) {
      await expect(
        resolveUniqueConnectionSlug({
          workspaceId,
          provider,
          externalAccountId: 'external-account',
          baseSlug,
        }),
      ).rejects.toBeInstanceOf(ConnectionSlugConflictError);
    }
  });

  it('still allocates provider-prefixed slugs derived from reserved words', async () => {
    const result = await resolveUniqueConnectionSlug({
      workspaceId,
      provider: 'github',
      externalAccountId: 'external-account',
      baseSlug: 'github_manual',
    });

    expect(result).toBe('github_manual');
  });

  it('keeps the existing slug when resolving a reconnect', async () => {
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'sentry',
      externalAccountId: 'install-uuid',
      slug: 'sentry_prod',
      displayName: 'Sentry',
      capabilities: [],
    });

    const result = await resolveUniqueConnectionSlug({
      workspaceId,
      provider: 'sentry',
      externalAccountId: 'install-uuid',
      baseSlug: 'sentry_renamed',
    });

    expect(result).toBe('sentry_prod');
  });

  it('creates a connection without upserting duplicates', async () => {
    const first = await createIntegrationConnection({
      workspaceId,
      provider: 'webhook',
      externalAccountId: 'stripe',
      slug: 'stripe',
      displayName: 'Stripe',
      capabilities: [],
    });

    const result = createIntegrationConnection({
      workspaceId,
      provider: 'webhook',
      externalAccountId: 'stripe',
      slug: 'stripe_renamed',
      displayName: 'Renamed Stripe',
      capabilities: [],
    });

    await expect(result).rejects.toBeInstanceOf(IntegrationConnectionAlreadyExistsError);
    const connections = await listIntegrationConnections({workspaceId});
    expect(connections).toHaveLength(1);
    expect(connections[0]?.id).toBe(first.id);
    expect(connections[0]?.displayName).toBe('Stripe');
    expect(await connectionEvents(first.id)).toHaveLength(1);
  });

  it('reports slug collisions separately from duplicate external accounts', async () => {
    await createIntegrationConnection({
      workspaceId,
      provider: 'webhook',
      externalAccountId: 'stripe',
      slug: 'stripe',
      displayName: 'Stripe',
      capabilities: [],
    });

    const result = createIntegrationConnection({
      workspaceId,
      provider: 'webhook',
      externalAccountId: 'stripe-prod',
      slug: 'stripe',
      displayName: 'Stripe prod',
      capabilities: [],
    });

    await expect(result).rejects.toBeInstanceOf(ConnectionSlugConflictError);
  });

  it('lists workspace connections across all lifecycle statuses', async () => {
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: 'team-1',
      slug: 'github_team_1',
      displayName: 'GitHub',
      capabilities: ['source_control', 'agent_tools'],
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: 'installation-1',
      slug: 'github_installation_1',
      displayName: 'GitHub',
      lifecycleStatus: 'disabled',
      capabilities: ['source_control', 'agent_tools'],
    });

    const result = await listIntegrationConnections({workspaceId});

    expect(result.map((connection) => [connection.provider, connection.lifecycleStatus])).toEqual([
      ['gitea', 'active'],
      ['github', 'active'],
      ['github', 'disabled'],
    ]);
  });

  it('lists connections for a provider across all workspaces', async () => {
    const otherWorkspaceId = crypto.randomUUID();
    const debugA = await upsertIntegrationConnection({
      workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });
    const debugB = await upsertIntegrationConnection({
      workspaceId: otherWorkspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });
    const github = await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: 'gh-1',
      slug: 'github_gh_1',
      displayName: 'GitHub',
      capabilities: ['source_control', 'agent_tools'],
    });

    const result = await listIntegrationConnectionsByProvider({provider: 'gitea'});

    const ids = result.map((connection) => connection.id);
    expect(result.every((connection) => connection.provider === 'gitea')).toBe(true);
    expect(ids).toEqual(expect.arrayContaining([debugA.id, debugB.id]));
    expect(ids).not.toContain(github.id);
  });

  it('updates a connection lifecycle status and returns the mapped connection', async () => {
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'sentry',
      externalAccountId: 'install-uuid',
      slug: 'sentry_install_uuid',
      displayName: 'Sentry acme',
      capabilities: [],
    });

    const updated = await updateIntegrationConnectionLifecycleStatus({
      id: connection.id,
      lifecycleStatus: 'disabled',
      capabilities: [],
    });

    expect(updated?.lifecycleStatus).toBe('disabled');
    const reloaded = await getIntegrationConnectionById(connection.id);
    expect(reloaded?.lifecycleStatus).toBe('disabled');
    expect(await connectionEvents(connection.id)).toHaveLength(1);
  });

  it('publishes availability when a disabled connection becomes active', async () => {
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'linear',
      externalAccountId: 'linear-acme',
      slug: 'linear_acme',
      displayName: 'Linear Acme',
      lifecycleStatus: 'disabled',
      capabilities: ['agent_tools'],
    });

    expect(await connectionEvents(connection.id)).toHaveLength(0);

    await updateIntegrationConnectionLifecycleStatus({
      id: connection.id,
      lifecycleStatus: 'active',
      capabilities: ['agent_tools'],
    });

    const events = await connectionEvents(connection.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      provider: 'linear',
      workspaceId,
      connectionId: connection.id,
      slug: 'linear_acme',
      capabilities: ['agent_tools'],
    });
  });

  it('does not republish availability when an active connection stays active', async () => {
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'linear',
      externalAccountId: 'linear-acme',
      slug: 'linear_acme',
      displayName: 'Linear Acme',
      capabilities: ['agent_tools'],
    });

    await updateIntegrationConnectionLifecycleStatus({
      id: connection.id,
      lifecycleStatus: 'active',
      capabilities: ['agent_tools'],
    });

    expect(await connectionEvents(connection.id)).toHaveLength(1);
  });

  it('returns undefined when updating the lifecycle status of an unknown connection', async () => {
    const result = await updateIntegrationConnectionLifecycleStatus({
      id: crypto.randomUUID(),
      lifecycleStatus: 'disabled',
      capabilities: [],
    });

    expect(result).toBeUndefined();
  });

  it('deletes a connection and reports whether a row was removed', async () => {
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'webhook',
      externalAccountId: 'stripe',
      slug: 'stripe',
      displayName: 'Stripe',
      capabilities: [],
    });

    const deleted = await deleteIntegrationConnection({id: connection.id});
    const deletedAgain = await deleteIntegrationConnection({id: connection.id});

    expect(deleted).toBe(true);
    expect(deletedAgain).toBe(false);
    expect(await getIntegrationConnectionById(connection.id)).toBeUndefined();
  });

  it('rolls back a connection when provider-specific installation persistence fails', async () => {
    const result = db().transaction(async (tx) => {
      const connection = await upsertIntegrationConnection(
        {
          workspaceId,
          provider: 'github',
          externalAccountId: '123',
          slug: 'github_123',
          displayName: 'GitHub shipfox',
          capabilities: ['source_control', 'agent_tools'],
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
    const events = await db()
      .select()
      .from(integrationsOutbox)
      .where(
        sql`${integrationsOutbox.eventType} = ${INTEGRATION_CONNECTION_AVAILABLE} AND ${integrationsOutbox.payload}->>'workspaceId' = ${workspaceId}`,
      );
    expect(events).toHaveLength(0);
  });

  it('publishes source-control and tool capabilities for a GitHub connection', async () => {
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: 'gh-capabilities',
      slug: 'github_capabilities',
      displayName: 'GitHub',
      capabilities: ['source_control', 'agent_tools'],
    });

    const [event] = await connectionEvents(connection.id);
    expect(event?.payload).toEqual({
      provider: 'github',
      workspaceId,
      connectionId: connection.id,
      slug: 'github_capabilities',
      capabilities: ['source_control', 'agent_tools'],
    });
  });

  it('publishes agent-tool capabilities for a Linear connection', async () => {
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'linear',
      externalAccountId: 'linear-capabilities',
      slug: 'linear_capabilities',
      displayName: 'Linear',
      capabilities: ['agent_tools'],
    });

    const [event] = await connectionEvents(connection.id);
    expect(event?.payload).toEqual({
      provider: 'linear',
      workspaceId,
      connectionId: connection.id,
      slug: 'linear_capabilities',
      capabilities: ['agent_tools'],
    });
  });

  it('publishes an empty capabilities array for a webhook connection', async () => {
    const connection = await createIntegrationConnection({
      workspaceId,
      provider: 'webhook',
      externalAccountId: 'stripe-capabilities',
      slug: 'stripe_capabilities',
      displayName: 'Stripe',
      capabilities: [],
    });

    const [event] = await connectionEvents(connection.id);
    expect(event?.payload).toEqual({
      provider: 'webhook',
      workspaceId,
      connectionId: connection.id,
      slug: 'stripe_capabilities',
      capabilities: [],
    });
  });
});
