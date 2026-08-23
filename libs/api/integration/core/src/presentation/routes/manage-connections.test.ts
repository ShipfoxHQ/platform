import {INTEGRATION_CONNECTION_AVAILABLE} from '@shipfox/api-integration-core-dto';
import {sql} from 'drizzle-orm';
import {createIntegrationProviderRegistry} from '#core/providers/registry.js';
import {processIntegrationSecretCleanups} from '#core/secret-cleanup.js';
import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';
import {db} from '#db/db.js';
import {integrationsOutbox} from '#db/schema/outbox.js';
import {listIntegrationSecretCleanups} from '#db/secret-cleanups.js';
import {createTestApp, sourceProvider, useIntegrationRouteTest} from '#test/route-utils.js';

describe('PATCH /integration-connections/:connectionId', () => {
  const context = useIntegrationRouteTest();

  it('updates a connection lifecycle status', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
      payload: {lifecycle_status: 'disabled'},
    });

    const reloaded = await getIntegrationConnectionById(connection.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().lifecycle_status).toBe('disabled');
    expect(res.json().capabilities).toEqual(['source_control']);
    expect(reloaded?.lifecycleStatus).toBe('disabled');
  });

  it('publishes provider capabilities when reactivating a connection', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      lifecycleStatus: 'disabled',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
      payload: {lifecycle_status: 'active'},
    });

    const [event] = await db()
      .select({payload: integrationsOutbox.payload})
      .from(integrationsOutbox)
      .where(
        sql`${integrationsOutbox.eventType} = ${INTEGRATION_CONNECTION_AVAILABLE} AND ${integrationsOutbox.payload}->>'connectionId' = ${connection.id}`,
      );

    expect(res.statusCode).toBe(200);
    expect(event?.payload).toEqual({
      provider: 'gitea',
      workspaceId: context.workspaceId,
      connectionId: connection.id,
      slug: 'gitea_owner',
      capabilities: ['source_control'],
    });
  });

  it('returns not-found for a missing connection', async () => {
    const app = await createTestApp([sourceProvider()]);

    const res = await app.inject({
      method: 'PATCH',
      url: `/integration-connections/${crypto.randomUUID()}`,
      headers: {authorization: 'Bearer user'},
      payload: {lifecycle_status: 'disabled'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  it('rejects system-owned lifecycle statuses', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
      payload: {lifecycle_status: 'error'},
    });

    const reloaded = await getIntegrationConnectionById(connection.id);
    expect(res.statusCode).toBe(400);
    expect(reloaded?.lifecycleStatus).toBe('active');
  });

  it('returns membership errors', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await upsertIntegrationConnection({
      workspaceId: crypto.randomUUID(),
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
      payload: {lifecycle_status: 'disabled'},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });
});

describe('DELETE /integration-connections/:connectionId', () => {
  const context = useIntegrationRouteTest();

  it('deletes a connection', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    const reloaded = await getIntegrationConnectionById(connection.id);
    expect(res.statusCode).toBe(204);
    expect(reloaded).toBeUndefined();
  });

  it('runs provider cleanup hooks while retaining ownership of the core row', async () => {
    const deleteConnectionRemoteResources = vi.fn(() => Promise.resolve(undefined));
    const deleteConnectionRecords = vi.fn(() => Promise.resolve());
    const deleteConnectionSecrets = vi.fn(() => Promise.resolve());
    const app = await createTestApp([
      sourceProvider({
        provider: 'slack',
        displayName: 'Slack',
        adapters: {},
        deleteConnectionRemoteResources,
        deleteConnectionRecords,
        deleteConnectionSecrets,
      }),
    ]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: 'T123',
      slug: 'slack_acme',
      displayName: 'Slack Acme',
      capabilities: [],
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    expect(deleteConnectionRemoteResources).toHaveBeenCalledWith(connection);
    expect(deleteConnectionRecords).toHaveBeenCalledWith(connection, {
      tx: expect.anything(),
    });
    expect(deleteConnectionSecrets).toHaveBeenCalledWith(connection);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
  });

  it('runs prepared remote cleanup after the local deletion commits', async () => {
    const events: string[] = [];
    const deleteConnectionRemoteResources = vi.fn(() => {
      events.push('prepare');
      return Promise.resolve(async () => {
        events.push('remote');
        await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
      });
    });
    const deleteConnectionRecords = vi.fn(() => {
      events.push('records');
      return Promise.resolve();
    });
    const deleteConnectionSecrets = vi.fn(() => {
      events.push('secrets');
      return Promise.resolve();
    });
    const app = await createTestApp([
      sourceProvider({
        provider: 'slack',
        displayName: 'Slack',
        adapters: {},
        deleteConnectionRemoteResources,
        deleteConnectionRecords,
        deleteConnectionSecrets,
      }),
    ]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: 'T123',
      slug: 'slack_acme',
      displayName: 'Slack Acme',
      capabilities: [],
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    expect(events).toEqual(['prepare', 'records', 'remote', 'secrets']);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
  });

  it('holds the provider deletion lock across local and remote cleanup', async () => {
    const events: string[] = [];
    const withConnectionDeletionLock = vi.fn(
      async (_connection: unknown, fn: () => Promise<void>) => {
        events.push('lock-enter');
        await fn();
        events.push('lock-exit');
      },
    );
    const app = await createTestApp([
      sourceProvider({
        provider: 'slack',
        displayName: 'Slack',
        adapters: {},
        withConnectionDeletionLock,
        deleteConnectionRemoteResources: vi.fn(() => {
          events.push('prepare');
          return Promise.resolve(() => {
            events.push('remote');
            return Promise.resolve();
          });
        }),
        deleteConnectionRecords: vi.fn(() => {
          events.push('records');
          return Promise.resolve();
        }),
        deleteConnectionSecrets: vi.fn(() => {
          events.push('secrets');
          return Promise.resolve();
        }),
      }),
    ]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: 'T123',
      slug: 'slack_acme',
      displayName: 'Slack Acme',
      capabilities: [],
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    expect(events).toEqual(['lock-enter', 'prepare', 'records', 'remote', 'secrets', 'lock-exit']);
    expect(withConnectionDeletionLock).toHaveBeenCalledWith(connection, expect.any(Function));
  });

  it('keeps the connection when provider record cleanup fails', async () => {
    const deleteConnectionSecrets = vi.fn(() => Promise.resolve());
    const app = await createTestApp([
      sourceProvider({
        provider: 'slack',
        displayName: 'Slack',
        adapters: {},
        deleteConnectionRecords: () => Promise.reject(new Error('record cleanup failed')),
        deleteConnectionSecrets,
      }),
    ]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: 'T123',
      slug: 'slack_acme',
      displayName: 'Slack Acme',
      capabilities: [],
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(500);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toMatchObject({
      id: connection.id,
    });
    expect(deleteConnectionSecrets).not.toHaveBeenCalled();
  });

  it('continues connection deletion when remote cleanup preparation fails', async () => {
    const deleteConnectionRemoteResources = vi.fn(() =>
      Promise.reject(new Error('remote cleanup failed')),
    );
    const app = await createTestApp([
      sourceProvider({
        provider: 'slack',
        displayName: 'Slack',
        adapters: {},
        deleteConnectionRemoteResources,
      }),
    ]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: 'T123',
      slug: 'slack_acme',
      displayName: 'Slack Acme',
      capabilities: [],
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    expect(deleteConnectionRemoteResources).toHaveBeenCalledWith(connection);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
  });

  it('continues connection deletion when post-commit remote cleanup fails', async () => {
    const deleteConnectionRemoteResources = vi.fn(() =>
      Promise.resolve(() => Promise.reject(new Error('remote cleanup failed'))),
    );
    const app = await createTestApp([
      sourceProvider({
        provider: 'slack',
        displayName: 'Slack',
        adapters: {},
        deleteConnectionRemoteResources,
      }),
    ]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: 'T123',
      slug: 'slack_acme',
      displayName: 'Slack Acme',
      capabilities: [],
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    expect(deleteConnectionRemoteResources).toHaveBeenCalledWith(connection);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
  });

  it('deletes the connection when provider secret cleanup fails after commit', async () => {
    const app = await createTestApp([
      sourceProvider({
        provider: 'slack',
        displayName: 'Slack',
        adapters: {},
        deleteConnectionSecrets: () => Promise.reject(new Error('secret cleanup failed')),
      }),
    ]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: 'T123',
      slug: 'slack_acme',
      displayName: 'Slack Acme',
      capabilities: [],
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
    await expect(
      listIntegrationSecretCleanups({connectionId: connection.id}),
    ).resolves.toMatchObject([
      {
        provider: 'slack',
        connectionId: connection.id,
        attemptCount: 1,
        leaseToken: null,
      },
    ]);
  });

  it('retries provider secret cleanup from a durable post-commit record', async () => {
    const deleteConnectionSecrets = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('transient cleanup failure'))
      .mockResolvedValue(undefined);
    const provider = sourceProvider({
      provider: 'slack',
      displayName: 'Slack',
      adapters: {},
      deleteConnectionSecrets,
    });
    const app = await createTestApp([provider]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: 'T123',
      slug: 'slack_acme',
      displayName: 'Slack Acme',
      capabilities: [],
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    const pending = await listIntegrationSecretCleanups({connectionId: connection.id});
    expect(res.statusCode).toBe(204);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      workspaceId: context.workspaceId,
      provider: 'slack',
      connectionId: connection.id,
      attemptCount: 1,
      leaseToken: null,
    });

    const result = await processIntegrationSecretCleanups({
      registry: createIntegrationProviderRegistry([provider]),
      connectionId: connection.id,
      now: new Date(Date.now() + 5 * 60 * 1_000),
      limit: 1,
    });

    expect(result).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      unavailable: 0,
      unacknowledged: 0,
    });
    await expect(listIntegrationSecretCleanups({connectionId: connection.id})).resolves.toEqual([]);
    expect(deleteConnectionSecrets).toHaveBeenCalledTimes(2);
    expect(deleteConnectionSecrets).toHaveBeenNthCalledWith(1, connection);
    expect(deleteConnectionSecrets).toHaveBeenNthCalledWith(2, connection);
  });

  it('deletes an unregistered provider connection without provider cleanup', async () => {
    const app = await createTestApp([]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'slack',
      externalAccountId: 'T123',
      slug: 'slack_acme',
      displayName: 'Slack Acme',
      capabilities: [],
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    await expect(getIntegrationConnectionById(connection.id)).resolves.toBeUndefined();
  });

  it('returns not-found for a missing connection', async () => {
    const app = await createTestApp([sourceProvider()]);

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${crypto.randomUUID()}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });
});
