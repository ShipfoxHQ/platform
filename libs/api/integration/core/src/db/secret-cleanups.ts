import {and, asc, eq, gt, inArray, isNull, lte, or, sql} from 'drizzle-orm';
import type {IntegrationConnection} from '#core/entities/connection.js';
import {db} from './db.js';
import {
  type IntegrationSecretCleanupDb,
  integrationSecretCleanups,
} from './schema/secret-cleanups.js';

// Keep the lease longer than cleanupIntegrationSecretsCron's 5-minute activity timeout so
// a timed-out sweep cannot have its claimed rows reclaimed while it is still running.
const DEFAULT_LEASE_DURATION_MS = 10 * 60 * 1_000;

export interface EnqueueIntegrationSecretCleanupParams {
  connection: IntegrationConnection;
  now?: Date | undefined;
}

export interface IntegrationSecretCleanup {
  id: string;
  workspaceId: string;
  provider: string;
  connectionId: string;
  externalAccountId: string;
  slug: string;
  displayName: string;
  lifecycleStatus: IntegrationConnection['lifecycleStatus'];
  repositoryAccessMode: IntegrationConnection['repositoryAccessMode'];
  connectionCreatedAt: Date;
  connectionUpdatedAt: Date;
  attemptCount: number;
  nextAttemptAt: Date;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type IntegrationDb = ReturnType<typeof db>;
type IntegrationTx = Parameters<Parameters<IntegrationDb['transaction']>[0]>[0];

export async function enqueueIntegrationSecretCleanup(
  params: EnqueueIntegrationSecretCleanupParams,
  options: {tx?: IntegrationDb | IntegrationTx | undefined} = {},
): Promise<void> {
  const executor = options.tx ?? db();
  await executor
    .insert(integrationSecretCleanups)
    .values({
      workspaceId: params.connection.workspaceId,
      provider: params.connection.provider,
      connectionId: params.connection.id,
      externalAccountId: params.connection.externalAccountId,
      slug: params.connection.slug,
      displayName: params.connection.displayName,
      lifecycleStatus: params.connection.lifecycleStatus,
      repositoryAccessMode: params.connection.repositoryAccessMode,
      connectionCreatedAt: params.connection.createdAt,
      connectionUpdatedAt: params.connection.updatedAt,
      // Claims compare against the application clock, so the first due time must come
      // from that clock too. A database clock even milliseconds ahead would otherwise
      // hide the row from the sweep that runs right after this insert commits.
      nextAttemptAt: params.now ?? new Date(),
    })
    .onConflictDoNothing({
      target: [integrationSecretCleanups.provider, integrationSecretCleanups.connectionId],
    });
}

export interface ClaimIntegrationSecretCleanupsParams {
  limit: number;
  connectionId?: string | undefined;
  now?: Date | undefined;
  leaseDurationMs?: number | undefined;
}

export async function claimIntegrationSecretCleanups(
  params: ClaimIntegrationSecretCleanupsParams,
): Promise<IntegrationSecretCleanup[]> {
  if (!Number.isInteger(params.limit) || params.limit <= 0) {
    throw new Error('Secret cleanup claim limit must be a positive integer');
  }
  const now = params.now ?? new Date();
  const leaseDurationMs = params.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  if (!Number.isInteger(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new Error('Secret cleanup lease duration must be a positive integer');
  }

  return await db().transaction(async (tx) => {
    const conditions = [
      lte(integrationSecretCleanups.nextAttemptAt, now),
      or(
        isNull(integrationSecretCleanups.leaseExpiresAt),
        lte(integrationSecretCleanups.leaseExpiresAt, now),
      ),
      ...(params.connectionId
        ? [eq(integrationSecretCleanups.connectionId, params.connectionId)]
        : []),
    ];
    const candidates = await tx
      .select({id: integrationSecretCleanups.id})
      .from(integrationSecretCleanups)
      .where(and(...conditions))
      .orderBy(
        asc(integrationSecretCleanups.nextAttemptAt),
        asc(integrationSecretCleanups.createdAt),
        asc(integrationSecretCleanups.id),
      )
      .limit(params.limit)
      .for('update', {skipLocked: true});
    if (candidates.length === 0) return [];

    const rows = await tx
      .update(integrationSecretCleanups)
      .set({
        attemptCount: sql`${integrationSecretCleanups.attemptCount} + 1`,
        leaseToken: sql`gen_random_uuid()`,
        leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
        updatedAt: now,
      })
      .where(
        inArray(
          integrationSecretCleanups.id,
          candidates.map((candidate) => candidate.id),
        ),
      )
      .returning();
    return rows.map(toIntegrationSecretCleanup);
  });
}

export async function completeIntegrationSecretCleanup(params: {
  id: string;
  leaseToken: string;
  now?: Date | undefined;
}): Promise<boolean> {
  const now = params.now ?? new Date();
  const result = await db()
    .delete(integrationSecretCleanups)
    .where(
      and(
        eq(integrationSecretCleanups.id, params.id),
        eq(integrationSecretCleanups.leaseToken, params.leaseToken),
        gt(integrationSecretCleanups.leaseExpiresAt, now),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

export async function retryIntegrationSecretCleanup(params: {
  id: string;
  leaseToken: string;
  delayMs: number;
  now?: Date | undefined;
}): Promise<boolean> {
  if (!Number.isInteger(params.delayMs) || params.delayMs < 0) {
    throw new Error('Secret cleanup retry delay must be a non-negative integer');
  }
  const now = params.now ?? new Date();
  const result = await db()
    .update(integrationSecretCleanups)
    .set({
      nextAttemptAt: new Date(now.getTime() + params.delayMs),
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(integrationSecretCleanups.id, params.id),
        eq(integrationSecretCleanups.leaseToken, params.leaseToken),
        gt(integrationSecretCleanups.leaseExpiresAt, now),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

export async function listIntegrationSecretCleanups(
  params: {connectionId?: string | undefined} = {},
): Promise<IntegrationSecretCleanup[]> {
  const rows = await db()
    .select()
    .from(integrationSecretCleanups)
    .where(
      params.connectionId
        ? eq(integrationSecretCleanups.connectionId, params.connectionId)
        : undefined,
    )
    .orderBy(asc(integrationSecretCleanups.createdAt), asc(integrationSecretCleanups.id));
  return rows.map(toIntegrationSecretCleanup);
}

function toIntegrationSecretCleanup(row: IntegrationSecretCleanupDb): IntegrationSecretCleanup {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider,
    connectionId: row.connectionId,
    externalAccountId: row.externalAccountId,
    slug: row.slug,
    displayName: row.displayName,
    lifecycleStatus: row.lifecycleStatus,
    repositoryAccessMode: row.repositoryAccessMode,
    connectionCreatedAt: row.connectionCreatedAt,
    connectionUpdatedAt: row.connectionUpdatedAt,
    attemptCount: row.attemptCount,
    nextAttemptAt: row.nextAttemptAt,
    leaseToken: row.leaseToken,
    leaseExpiresAt: row.leaseExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
