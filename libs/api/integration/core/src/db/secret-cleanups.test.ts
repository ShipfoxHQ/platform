import {afterEach} from '@shipfox/vitest/vi';
import {sql} from 'drizzle-orm';
import {CLEANUP_SECRETS_ACTIVITY_TIMEOUT_MS} from '#temporal/constants.js';
import {upsertIntegrationConnection} from './connections.js';
import {db} from './db.js';
import {
  claimIntegrationSecretCleanups,
  completeIntegrationSecretCleanup,
  enqueueIntegrationSecretCleanup,
  retryIntegrationSecretCleanup,
} from './secret-cleanups.js';

const now = new Date(Date.now() + 60 * 1_000);

afterEach(async () => {
  await db().execute(sql`TRUNCATE integrations_secret_cleanups CASCADE`);
});

describe('integration secret cleanup persistence', () => {
  it('keeps the default lease longer than the cleanup activity timeout', async () => {
    await createCleanupConnection();

    const [claimed] = await claimIntegrationSecretCleanups({limit: 1, now});

    if (!claimed?.leaseExpiresAt) throw new Error('Expected the cleanup to have a lease');
    expect(claimed.leaseExpiresAt.getTime() - now.getTime()).toBeGreaterThan(
      CLEANUP_SECRETS_ACTIVITY_TIMEOUT_MS,
    );
  });

  it('claims a due row once and reclaims it after its lease expires', async () => {
    const connection = await createCleanupConnection();
    const [queued] = await claimIntegrationSecretCleanups({limit: 1, now, leaseDurationMs: 1_000});

    expect(queued).toMatchObject({
      connectionId: connection.id,
      attemptCount: 1,
      leaseToken: expect.any(String),
    });
    await expect(claimIntegrationSecretCleanups({limit: 1, now})).resolves.toEqual([]);

    const wrongLeaseToken = crypto.randomUUID();
    await expect(
      completeIntegrationSecretCleanup({
        id: queued?.id ?? '',
        leaseToken: wrongLeaseToken,
        now,
      }),
    ).resolves.toBe(false);
    await expect(
      retryIntegrationSecretCleanup({
        id: queued?.id ?? '',
        leaseToken: wrongLeaseToken,
        delayMs: 1_000,
        now,
      }),
    ).resolves.toBe(false);

    const [reclaimed] = await claimIntegrationSecretCleanups({
      limit: 1,
      now: new Date(now.getTime() + 1_001),
      leaseDurationMs: 1_000,
    });
    expect(reclaimed).toMatchObject({
      id: queued?.id,
      attemptCount: 2,
      leaseToken: expect.any(String),
    });

    await expect(
      completeIntegrationSecretCleanup({
        id: reclaimed?.id ?? '',
        leaseToken: reclaimed?.leaseToken ?? '',
        now: new Date(now.getTime() + 1_001),
      }),
    ).resolves.toBe(true);
  });

  it('honors the batch limit and retry backoff', async () => {
    await createCleanupConnection({externalAccountId: 'first'});
    await createCleanupConnection({externalAccountId: 'second'});

    const firstClaim = await claimIntegrationSecretCleanups({limit: 1, now});
    expect(firstClaim).toHaveLength(1);
    const first = firstClaim[0];
    if (!first?.leaseToken) throw new Error('Expected the first cleanup to have a lease');

    await expect(
      retryIntegrationSecretCleanup({
        id: first.id,
        leaseToken: first.leaseToken,
        delayMs: 5_000,
        now,
      }),
    ).resolves.toBe(true);

    const secondClaim = await claimIntegrationSecretCleanups({limit: 2, now});
    expect(secondClaim).toHaveLength(1);
    expect(secondClaim[0]?.id).not.toBe(first.id);
  });
});

async function createCleanupConnection(overrides: {externalAccountId?: string} = {}) {
  const connection = await upsertIntegrationConnection({
    workspaceId: crypto.randomUUID(),
    provider: 'slack',
    externalAccountId: overrides.externalAccountId ?? crypto.randomUUID(),
    slug: `slack_${crypto.randomUUID()}`,
    displayName: 'Slack',
    capabilities: ['agent_tools'],
  });
  await enqueueIntegrationSecretCleanup({connection});
  return connection;
}
