import {afterEach} from '@shipfox/vitest/vi';
import {sql} from 'drizzle-orm';
import {createIntegrationProviderRegistry} from '#core/providers/registry.js';
import {
  updateIntegrationConnectionRepositoryAccessMode,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {
  enqueueIntegrationSecretCleanup,
  listIntegrationSecretCleanups,
} from '#db/secret-cleanups.js';
import {processIntegrationSecretCleanups} from './secret-cleanup.js';

afterEach(async () => {
  await db().execute(sql`TRUNCATE integrations_secret_cleanups CASCADE`);
});

describe('processIntegrationSecretCleanups', () => {
  it('retries rows for providers that are not loaded', async () => {
    const connection = await createCleanupConnection();
    const now = cleanupNow();

    await expect(
      processIntegrationSecretCleanups({
        registry: createIntegrationProviderRegistry([]),
        now,
      }),
    ).resolves.toEqual({claimed: 1, completed: 0, failed: 0, unavailable: 1, unacknowledged: 0});

    const [pending] = await listIntegrationSecretCleanups({connectionId: connection.id});
    expect(pending).toMatchObject({
      attemptCount: 1,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    if (!pending) throw new Error('Expected the cleanup to remain pending');
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it('counts a retry whose lease is lost before acknowledgement', async () => {
    const connection = await createCleanupConnection();
    const provider = {
      provider: 'slack',
      displayName: 'Slack',
      deleteConnectionSecrets: vi.fn(async () => {
        await db().execute(sql`
          UPDATE integrations_secret_cleanups
          SET lease_expires_at = now() - interval '1 second'
          WHERE connection_id = ${connection.id}
        `);
        throw new Error('transient failure');
      }),
    };

    await expect(
      processIntegrationSecretCleanups({
        registry: createIntegrationProviderRegistry([provider]),
        now: cleanupNow(),
      }),
    ).resolves.toEqual({claimed: 1, completed: 0, failed: 1, unavailable: 0, unacknowledged: 1});
  });

  it('acknowledges a cleanup when a loaded provider has no secret hook', async () => {
    const connection = await createCleanupConnection({provider: 'gitea'});
    const provider = {provider: 'gitea', displayName: 'Gitea'};

    await expect(
      processIntegrationSecretCleanups({
        registry: createIntegrationProviderRegistry([provider]),
        now: cleanupNow(),
      }),
    ).resolves.toEqual({claimed: 1, completed: 1, failed: 0, unavailable: 0, unacknowledged: 0});
    await expect(listIntegrationSecretCleanups({connectionId: connection.id})).resolves.toEqual([]);
  });

  it('continues a batch after one provider cleanup fails', async () => {
    const failedConnection = await createCleanupConnection({externalAccountId: 'failed'});
    const completedConnection = await createCleanupConnection({
      externalAccountId: 'completed',
      repositoryAccessMode: 'all',
    });
    const deleteConnectionSecrets = vi.fn((connection: {id: string}) => {
      if (connection.id === failedConnection.id) {
        return Promise.reject(new Error('transient failure'));
      }
      return Promise.resolve();
    });
    const provider = {
      provider: 'slack',
      displayName: 'Slack',
      deleteConnectionSecrets,
    };

    await expect(
      processIntegrationSecretCleanups({
        registry: createIntegrationProviderRegistry([provider]),
        limit: 2,
        now: cleanupNow(),
      }),
    ).resolves.toEqual({claimed: 2, completed: 1, failed: 1, unavailable: 0, unacknowledged: 0});
    expect(deleteConnectionSecrets).toHaveBeenCalledWith({
      id: completedConnection.id,
      workspaceId: completedConnection.workspaceId,
      provider: completedConnection.provider,
      externalAccountId: completedConnection.externalAccountId,
      slug: completedConnection.slug,
      displayName: completedConnection.displayName,
      lifecycleStatus: completedConnection.lifecycleStatus,
      repositoryAccessMode: 'all',
      createdAt: completedConnection.createdAt,
      updatedAt: completedConnection.updatedAt,
    });
    await expect(
      listIntegrationSecretCleanups({connectionId: failedConnection.id}),
    ).resolves.toHaveLength(1);
  });
});

async function createCleanupConnection(
  overrides: {
    externalAccountId?: string;
    provider?: string;
    repositoryAccessMode?: 'selected' | 'all';
  } = {},
) {
  const created = await upsertIntegrationConnection({
    workspaceId: crypto.randomUUID(),
    provider: overrides.provider ?? 'slack',
    externalAccountId: overrides.externalAccountId ?? crypto.randomUUID(),
    slug: `${overrides.provider ?? 'slack'}_${crypto.randomUUID()}`,
    displayName: overrides.provider ?? 'Slack',
    capabilities: overrides.provider === 'gitea' ? ['source_control'] : ['agent_tools'],
  });
  const connection =
    overrides.repositoryAccessMode === undefined
      ? created
      : ((await updateIntegrationConnectionRepositoryAccessMode({
          id: created.id,
          repositoryAccessMode: overrides.repositoryAccessMode,
        })) ?? created);
  await enqueueIntegrationSecretCleanup({connection});
  return connection;
}

function cleanupNow(): Date {
  return new Date(Date.now() + 60 * 1_000);
}
