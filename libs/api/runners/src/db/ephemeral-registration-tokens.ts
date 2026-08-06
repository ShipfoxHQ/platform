import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import {and, asc, eq, gt, inArray, isNull, lt, sql} from 'drizzle-orm';
import type {EphemeralRegistrationToken} from '#core/entities/ephemeral-registration-token.js';
import {
  ActiveEphemeralRegistrationTokenExistsError,
  ActiveEphemeralRegistrationTokensExistError,
  EmptyRunnerLabelsError,
  RegistrationTokenBatchExceedsReservationError,
  RegistrationTokenConsumedError,
  RegistrationTokenExpiredError,
  RegistrationTokenWorkspaceMismatchError,
  ReservationExpiredError,
  ReservationNotFoundError,
} from '#core/errors.js';
import {sanitizeRunnerLabelsOrThrow} from '#core/runner-labels.js';
import {db} from './db.js';
import {
  ephemeralRegistrationTokens,
  toEphemeralRegistrationToken,
} from './schema/ephemeral-registration-tokens.js';
import {provisionerTokens} from './schema/provisioner-tokens.js';
import {reservations} from './schema/reservations.js';
import {providerRunners} from './schema/runner-instances.js';
import {runnerSessions, toRunnerSession} from './schema/runner-sessions.js';

export interface CreateEphemeralRegistrationTokenParams {
  workspaceId: string;
  provisionerId: string;
  reservationId?: string | null | undefined;
  providerRunnerId: string;
  hashedToken: string;
  prefix: string;
  expiresAt: Date;
}

export interface CreateEphemeralRegistrationTokensBatchRow {
  providerRunnerId: string;
  hashedToken: string;
  prefix: string;
}

export interface CreateEphemeralRegistrationTokensBatchParams {
  workspaceId: string;
  provisionerId: string;
  reservationId: string;
  expiresAt: Date;
  rows: CreateEphemeralRegistrationTokensBatchRow[];
}

export async function createEphemeralRegistrationToken(
  params: CreateEphemeralRegistrationTokenParams,
): Promise<EphemeralRegistrationToken> {
  const rows = await db().transaction(async (tx) => {
    const providerRunnerLockKey = [
      'runners_ephemeral_registration_tokens',
      params.workspaceId,
      params.provisionerId,
      params.providerRunnerId,
    ].join(':');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${providerRunnerLockKey}))`);

    const [active] = await tx
      .select({id: ephemeralRegistrationTokens.id})
      .from(ephemeralRegistrationTokens)
      .where(
        and(
          eq(ephemeralRegistrationTokens.workspaceId, params.workspaceId),
          eq(ephemeralRegistrationTokens.provisionerId, params.provisionerId),
          eq(ephemeralRegistrationTokens.providerRunnerId, params.providerRunnerId),
          isNull(ephemeralRegistrationTokens.consumedAt),
          gt(ephemeralRegistrationTokens.expiresAt, sql`now()`),
        ),
      )
      .limit(1);

    if (active) {
      throw new ActiveEphemeralRegistrationTokenExistsError(
        params.workspaceId,
        params.provisionerId,
        params.providerRunnerId,
      );
    }

    return await tx
      .insert(ephemeralRegistrationTokens)
      .values({
        workspaceId: params.workspaceId,
        provisionerId: params.provisionerId,
        reservationId: params.reservationId ?? null,
        providerRunnerId: params.providerRunnerId,
        hashedToken: params.hashedToken,
        prefix: params.prefix,
        expiresAt: params.expiresAt,
      })
      .returning();
  });

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toEphemeralRegistrationToken(row);
}

export async function createEphemeralRegistrationTokensBatch(
  params: CreateEphemeralRegistrationTokensBatchParams,
): Promise<EphemeralRegistrationToken[]> {
  const rows = await db().transaction(async (tx) => {
    const provisionerLockKey = [
      'runners_ephemeral_registration_tokens',
      params.workspaceId,
      params.provisionerId,
    ].join(':');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${provisionerLockKey}))`);
    for (const providerRunnerId of [
      ...new Set(params.rows.map((row) => row.providerRunnerId)),
    ].sort()) {
      const providerRunnerLockKey = [
        'runners_ephemeral_registration_tokens',
        params.workspaceId,
        params.provisionerId,
        providerRunnerId,
      ].join(':');
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${providerRunnerLockKey}))`);
    }

    const [reservation] = await tx
      .select({
        count: reservations.count,
        isExpired: sql<boolean>`${reservations.expiresAt} <= now()`,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.id, params.reservationId),
          eq(reservations.workspaceId, params.workspaceId),
          eq(reservations.provisionerId, params.provisionerId),
        ),
      )
      .limit(1);

    if (!reservation) throw new ReservationNotFoundError(params.reservationId);
    if (reservation.isExpired) throw new ReservationExpiredError(params.reservationId);
    if (params.rows.length > reservation.count) {
      throw new RegistrationTokenBatchExceedsReservationError(
        params.rows.length,
        reservation.count,
      );
    }

    const [existingForReservation] = await tx
      .select({count: sql<number>`count(*)::int`})
      .from(ephemeralRegistrationTokens)
      .where(
        and(
          eq(ephemeralRegistrationTokens.workspaceId, params.workspaceId),
          eq(ephemeralRegistrationTokens.provisionerId, params.provisionerId),
          eq(ephemeralRegistrationTokens.reservationId, params.reservationId),
        ),
      );
    const alreadyMinted = existingForReservation?.count ?? 0;
    if (alreadyMinted + params.rows.length > reservation.count) {
      throw new RegistrationTokenBatchExceedsReservationError(
        params.rows.length,
        reservation.count,
        alreadyMinted,
      );
    }

    const providerRunnerIds = params.rows.map((row) => row.providerRunnerId);
    const activeRows = await tx
      .select({providerRunnerId: ephemeralRegistrationTokens.providerRunnerId})
      .from(ephemeralRegistrationTokens)
      .where(
        and(
          eq(ephemeralRegistrationTokens.workspaceId, params.workspaceId),
          eq(ephemeralRegistrationTokens.provisionerId, params.provisionerId),
          inArray(ephemeralRegistrationTokens.providerRunnerId, providerRunnerIds),
          isNull(ephemeralRegistrationTokens.consumedAt),
          gt(ephemeralRegistrationTokens.expiresAt, sql`now()`),
        ),
      );

    if (activeRows.length > 0) {
      throw new ActiveEphemeralRegistrationTokensExistError(
        activeRows.map((row) => row.providerRunnerId),
      );
    }

    return await tx
      .insert(ephemeralRegistrationTokens)
      .values(
        params.rows.map((row) => ({
          workspaceId: params.workspaceId,
          provisionerId: params.provisionerId,
          reservationId: params.reservationId,
          providerRunnerId: row.providerRunnerId,
          hashedToken: row.hashedToken,
          prefix: row.prefix,
          expiresAt: params.expiresAt,
        })),
      )
      .returning();
  });

  return rows.map(toEphemeralRegistrationToken);
}

export async function resolveEphemeralRegistrationTokenByHash(
  hashedToken: string,
): Promise<EphemeralRegistrationToken | undefined> {
  const rows = await db()
    .select()
    .from(ephemeralRegistrationTokens)
    .where(eq(ephemeralRegistrationTokens.hashedToken, hashedToken))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toEphemeralRegistrationToken(row);
}

export interface DeleteExpiredEphemeralRegistrationTokensParams {
  retentionDays: number;
  limit?: number;
}

/**
 * Deletes ephemeral registration tokens that have reached a terminal state and
 * outlived the retention window. A token is terminal once it is consumed
 * (single use spent) or expired without consumption; the retention window is
 * measured from that terminal event so the audit record survives a bounded
 * debugging window. Active tokens that are neither consumed nor expired are
 * never deleted, so a live single-use credential is never removed early.
 */
export async function deleteExpiredEphemeralRegistrationTokens(
  params: DeleteExpiredEphemeralRegistrationTokensParams,
): Promise<number> {
  // coalesce(consumed_at, expires_at) is the terminal timestamp: consumed_at
  // when the token was spent, otherwise its expiry. Comparing it to the cutoff
  // both selects deletable rows and orders the batch, and it matches the
  // terminal index so idle GC ticks never scan live rows.
  const terminalAt = sql`coalesce(${ephemeralRegistrationTokens.consumedAt}, ${ephemeralRegistrationTokens.expiresAt})`;
  const retentionCutoff = sql`now() - (${params.retentionDays} || ' days')::interval`;

  const deletableIds = db()
    .select({id: ephemeralRegistrationTokens.id})
    .from(ephemeralRegistrationTokens)
    .where(lt(terminalAt, retentionCutoff))
    .orderBy(asc(terminalAt), asc(ephemeralRegistrationTokens.id))
    .limit(params.limit ?? 1000);

  const deleted = await db()
    .delete(ephemeralRegistrationTokens)
    .where(inArray(ephemeralRegistrationTokens.id, deletableIds))
    .returning({id: ephemeralRegistrationTokens.id});

  return deleted.length;
}

export async function createRunnerSessionConsumingEphemeralToken(params: {
  ephemeralTokenId: string;
  workspaceId: string;
  labels: string[];
  toolCapabilities?: RunnerToolCapabilitiesDto | null;
  maxClaims: number;
}) {
  return await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.workspaceId}))`);

    const consumed = await tx
      .update(ephemeralRegistrationTokens)
      .set({consumedAt: sql`now()`})
      .where(
        and(
          eq(ephemeralRegistrationTokens.id, params.ephemeralTokenId),
          eq(ephemeralRegistrationTokens.workspaceId, params.workspaceId),
          isNull(ephemeralRegistrationTokens.consumedAt),
          gt(ephemeralRegistrationTokens.expiresAt, sql`now()`),
        ),
      )
      .returning({
        id: ephemeralRegistrationTokens.id,
        provisionerId: ephemeralRegistrationTokens.provisionerId,
        providerRunnerId: ephemeralRegistrationTokens.providerRunnerId,
      });

    if (!consumed[0]) {
      const [token] = await tx
        .select({
          workspaceId: ephemeralRegistrationTokens.workspaceId,
          consumedAt: ephemeralRegistrationTokens.consumedAt,
          isExpired: sql<boolean>`${ephemeralRegistrationTokens.expiresAt} <= now()`,
        })
        .from(ephemeralRegistrationTokens)
        .where(eq(ephemeralRegistrationTokens.id, params.ephemeralTokenId))
        .limit(1);

      if (!token) {
        throw new Error(`Ephemeral registration token not found: ${params.ephemeralTokenId}`);
      }
      if (token.workspaceId !== params.workspaceId) {
        throw new RegistrationTokenWorkspaceMismatchError(
          params.ephemeralTokenId,
          params.workspaceId,
        );
      }
      if (token.consumedAt) throw new RegistrationTokenConsumedError(params.ephemeralTokenId);
      if (token.isExpired) throw new RegistrationTokenExpiredError(params.ephemeralTokenId);
      throw new Error(
        `Ephemeral registration token could not be consumed: ${params.ephemeralTokenId}`,
      );
    }

    const [provisioner] = await tx
      .select({scope: provisionerTokens.scope})
      .from(provisionerTokens)
      .where(eq(provisionerTokens.id, consumed[0].provisionerId))
      .limit(1);
    const labels = sanitizeRunnerLabelsOrThrow(params.labels, {
      scope: provisioner?.scope ?? 'workspace',
      source: 'ephemeral runner registration',
    });
    if (labels.length === 0) throw new EmptyRunnerLabelsError();

    const [session] = await tx
      .insert(runnerSessions)
      .values({
        workspaceId: params.workspaceId,
        scope: 'workspace',
        registrationTokenId: params.ephemeralTokenId,
        registrationTokenKind: 'ephemeral',
        provisionerId: consumed[0].provisionerId,
        providerRunnerId: consumed[0].providerRunnerId,
        labels,
        toolCapabilities: params.toolCapabilities ?? null,
        toolCapabilitiesReportedAt: params.toolCapabilities ? sql`now()` : null,
        maxClaims: params.maxClaims,
        claimsUsed: 0,
      })
      .returning();

    if (!session) throw new Error('Insert returned no rows');

    await tx
      .update(ephemeralRegistrationTokens)
      .set({consumedSessionId: session.id})
      .where(eq(ephemeralRegistrationTokens.id, params.ephemeralTokenId));

    await tx
      .update(providerRunners)
      .set({runnerSessionId: session.id, updatedAt: sql`now()`})
      .where(
        and(
          eq(providerRunners.workspaceId, params.workspaceId),
          eq(providerRunners.provisionerId, consumed[0].provisionerId),
          eq(providerRunners.providerRunnerId, consumed[0].providerRunnerId),
          isNull(providerRunners.reservationReleasedAt),
        ),
      );

    return toRunnerSession(session);
  });
}
