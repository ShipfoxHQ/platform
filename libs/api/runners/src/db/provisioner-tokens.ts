import type {
  AdministrationActionEvent,
  AdministrationActionEventMap,
} from '@shipfox/api-common-dto';
import {type TimestampIdCursor, timestampIdCursorWhere} from '@shipfox/node-drizzle';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, desc, eq, gt, inArray, isNotNull, isNull, lte, or, type SQL, sql} from 'drizzle-orm';
import type {
  ActiveProvisionerToken,
  ProvisionerScope,
  ProvisionerToken,
} from '#core/entities/provisioner-token.js';
import {ProvisionerAdminIdempotencyKeyReuseError} from '#core/errors.js';
import {db} from './db.js';
import {releaseTerminalRunnerInstanceReservationsByIds} from './reservations.js';
import {runnersAdminCommandResults} from './schema/admin-command-results.js';
import {runnersOutbox} from './schema/outbox.js';
import {provisionerTokens, toProvisionerToken} from './schema/provisioner-tokens.js';
import {runnerActivationTokens} from './schema/runner-activation-tokens.js';
import {runnerBootstrapTokens, runnerControlSessions} from './schema/runner-control-sessions.js';
import {providerRunners} from './schema/runner-instances.js';
import {runnerSessions} from './schema/runner-sessions.js';

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

export interface CreateProvisionerTokenParams {
  scope: ProvisionerScope;
  workspaceId?: string | undefined;
  hashedToken: string;
  prefix: string;
  createdByUserId: string;
  name?: string | undefined;
  expiresAt?: Date | undefined;
}

async function cascadeProvisionerRevocation(tx: Tx, provisionerId: string) {
  await tx
    .update(runnerBootstrapTokens)
    .set({revokedAt: sql`now()`})
    .where(eq(runnerBootstrapTokens.provisionerId, provisionerId));
  await tx
    .update(runnerControlSessions)
    .set({closedAt: sql`now()`, closeReason: 'provisioner-revoked'})
    .where(
      and(
        eq(runnerControlSessions.provisionerId, provisionerId),
        isNull(runnerControlSessions.closedAt),
      ),
    );
  await tx
    .update(runnerActivationTokens)
    .set({revokedAt: sql`now()`})
    .where(
      and(
        isNull(runnerActivationTokens.consumedAt),
        isNull(runnerActivationTokens.revokedAt),
        inArray(
          runnerActivationTokens.runnerInstanceId,
          tx
            .select({id: providerRunners.id})
            .from(providerRunners)
            .where(eq(providerRunners.provisionerId, provisionerId)),
        ),
      ),
    );
  const terminatedRows = await tx
    .update(providerRunners)
    .set({state: 'terminated', terminatedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(providerRunners.provisionerId, provisionerId),
        isNull(providerRunners.runnerSessionId),
      ),
    )
    .returning({id: providerRunners.id});
  const runnerInstanceIds = terminatedRows.map((row) => row.id);
  if (runnerInstanceIds.length > 0) {
    await releaseTerminalRunnerInstanceReservationsByIds(tx, {
      workspaceId: null,
      provisionerId,
      runnerInstanceIds,
      requireUnlinkedSession: false,
    });
  }
  await tx
    .update(runnerSessions)
    .set({revokedAt: sql`now()`})
    .where(
      and(
        eq(runnerSessions.provisionerId, provisionerId),
        eq(runnerSessions.claimsUsed, 0),
        isNull(runnerSessions.revokedAt),
      ),
    );
}

async function insertProvisionerToken(tx: Tx, params: CreateProvisionerTokenParams) {
  const rows = await tx
    .insert(provisionerTokens)
    .values({
      scope: params.scope,
      workspaceId: params.workspaceId ?? null,
      hashedToken: params.hashedToken,
      prefix: params.prefix,
      createdByUserId: params.createdByUserId,
      name: params.name ?? null,
      expiresAt: params.expiresAt ?? null,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return row;
}

export async function createProvisionerToken(
  params: CreateProvisionerTokenParams,
): Promise<ProvisionerToken> {
  const row = await db().transaction((tx) => insertProvisionerToken(tx, params));
  return toProvisionerToken(row);
}

interface AuditedProvisionerTokenCommandParams {
  actorId: string;
  command: string;
  correlationId: string;
  idempotencyKeyFingerprint: string;
  requestFingerprint: string;
  event: (tokenId: string) => AdministrationActionEvent;
}

async function lockAdminCommand(
  tx: Tx,
  params: Pick<AuditedProvisionerTokenCommandParams, 'actorId' | 'idempotencyKeyFingerprint'>,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`runners_admin_command:${params.actorId}:${params.idempotencyKeyFingerprint}`}))`,
  );
}

async function loadAdminCommandResult(
  tx: Tx,
  params: Pick<
    AuditedProvisionerTokenCommandParams,
    'actorId' | 'idempotencyKeyFingerprint' | 'requestFingerprint'
  > & {command: string},
) {
  const rows = await tx
    .select()
    .from(runnersAdminCommandResults)
    .where(
      and(
        eq(runnersAdminCommandResults.actorId, params.actorId),
        eq(runnersAdminCommandResults.idempotencyKeyFingerprint, params.idempotencyKeyFingerprint),
      ),
    )
    .limit(1);
  const result = rows[0];
  if (!result) return undefined;
  if (
    result.command !== params.command ||
    result.requestFingerprint !== params.requestFingerprint
  ) {
    throw new ProvisionerAdminIdempotencyKeyReuseError();
  }
  return result;
}

async function storeAdminCommandResult(
  tx: Tx,
  params: AuditedProvisionerTokenCommandParams,
  result: {provisionerTokenId: string; correlationId: string},
): Promise<void> {
  await tx.insert(runnersAdminCommandResults).values({
    actorId: params.actorId,
    idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
    command: params.command,
    requestFingerprint: params.requestFingerprint,
    result,
  });
}

async function writeAdministrationAction(tx: Tx, event: AdministrationActionEvent): Promise<void> {
  await writeOutboxEvent<AdministrationActionEventMap>(tx, runnersOutbox, {
    type: 'administration.action.performed',
    payload: event,
  });
}

export async function createInstallationProvisionerTokenWithAudit(
  params: AuditedProvisionerTokenCommandParams & {
    name?: string | undefined;
    ttlSeconds?: number | undefined;
    hashedToken: string;
    prefix: string;
  },
): Promise<{token: ProvisionerToken; correlationId: string; replayed: boolean}> {
  const command = 'runners.provisioner_token.create';
  return await db().transaction(async (tx) => {
    await lockAdminCommand(tx, params);
    const existing = await loadAdminCommandResult(tx, {
      actorId: params.actorId,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      requestFingerprint: params.requestFingerprint,
      command,
    });
    if (existing) {
      const rows = await tx
        .select()
        .from(provisionerTokens)
        .where(eq(provisionerTokens.id, existing.result.provisionerTokenId))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error('Idempotent provisioner token result is missing');
      return {
        token: toProvisionerToken(row),
        correlationId: existing.result.correlationId,
        replayed: true,
      };
    }

    const expiresAt =
      params.ttlSeconds === undefined ? undefined : new Date(Date.now() + params.ttlSeconds * 1000);
    const row = await insertProvisionerToken(tx, {
      scope: 'installation',
      hashedToken: params.hashedToken,
      prefix: params.prefix,
      createdByUserId: params.actorId,
      name: params.name,
      expiresAt,
    });
    const event = params.event(row.id);
    await writeAdministrationAction(tx, event);
    await storeAdminCommandResult(tx, params, {
      provisionerTokenId: row.id,
      correlationId: event.correlationId,
    });
    return {token: toProvisionerToken(row), correlationId: event.correlationId, replayed: false};
  });
}

export async function revokeInstallationProvisionerToken(params: {
  tokenId: string;
  revokedByUserId: string;
}): Promise<ProvisionerToken | undefined> {
  const rows = await db().transaction(async (tx) => {
    const rows = await tx
      .update(provisionerTokens)
      .set({revokedAt: new Date(), revokedByUserId: params.revokedByUserId, updatedAt: new Date()})
      .where(
        and(
          eq(provisionerTokens.id, params.tokenId),
          eq(provisionerTokens.scope, 'installation'),
          isNull(provisionerTokens.revokedAt),
        ),
      )
      .returning();
    if (rows[0]) {
      await cascadeProvisionerRevocation(tx, params.tokenId);
    }
    return rows;
  });

  const row = rows[0];
  if (row) return toProvisionerToken(row);

  const existingRows = await db()
    .select()
    .from(provisionerTokens)
    .where(
      and(eq(provisionerTokens.id, params.tokenId), eq(provisionerTokens.scope, 'installation')),
    )
    .limit(1);
  const existingRow = existingRows[0];
  return existingRow ? toProvisionerToken(existingRow) : undefined;
}

export async function revokeInstallationProvisionerTokenWithAudit(
  params: AuditedProvisionerTokenCommandParams & {tokenId: string},
): Promise<{token: ProvisionerToken; correlationId: string; replayed: boolean} | undefined> {
  const command = 'runners.provisioner_token.revoke';
  return await db().transaction(async (tx) => {
    await lockAdminCommand(tx, params);
    const existing = await loadAdminCommandResult(tx, {
      actorId: params.actorId,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      requestFingerprint: params.requestFingerprint,
      command,
    });
    if (existing) {
      const rows = await tx
        .select()
        .from(provisionerTokens)
        .where(eq(provisionerTokens.id, existing.result.provisionerTokenId))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error('Idempotent provisioner token result is missing');
      return {
        token: toProvisionerToken(row),
        correlationId: existing.result.correlationId,
        replayed: true,
      };
    }

    const updatedRows = await tx
      .update(provisionerTokens)
      .set({revokedAt: new Date(), revokedByUserId: params.actorId, updatedAt: new Date()})
      .where(
        and(
          eq(provisionerTokens.id, params.tokenId),
          eq(provisionerTokens.scope, 'installation'),
          isNull(provisionerTokens.revokedAt),
        ),
      )
      .returning();
    const row = updatedRows[0];
    if (row) await cascadeProvisionerRevocation(tx, params.tokenId);

    const existingRows = row
      ? [row]
      : await tx
          .select()
          .from(provisionerTokens)
          .where(
            and(
              eq(provisionerTokens.id, params.tokenId),
              eq(provisionerTokens.scope, 'installation'),
            ),
          )
          .limit(1);
    const tokenRow = existingRows[0];
    if (!tokenRow) return undefined;

    const changed = row !== undefined;
    const event = changed ? params.event(tokenRow.id) : undefined;
    if (event) await writeAdministrationAction(tx, event);
    await storeAdminCommandResult(tx, params, {
      provisionerTokenId: tokenRow.id,
      correlationId: event?.correlationId ?? params.correlationId,
    });
    return {
      token: toProvisionerToken(tokenRow),
      correlationId: event?.correlationId ?? params.correlationId,
      replayed: false,
    };
  });
}

export type InstallationProvisionerTokenStatus = 'active' | 'expired' | 'revoked';

export interface ListInstallationProvisionerTokensParams {
  limit: number;
  cursor?: TimestampIdCursor | undefined;
  status?: InstallationProvisionerTokenStatus | undefined;
}

export async function listInstallationProvisionerTokens(
  params: ListInstallationProvisionerTokensParams,
): Promise<{tokens: ProvisionerToken[]; nextCursor: TimestampIdCursor | null}> {
  const conditions: SQL[] = [eq(provisionerTokens.scope, 'installation')];
  const cursor = timestampIdCursorWhere({
    timestampColumn: provisionerTokens.createdAt,
    idColumn: provisionerTokens.id,
    cursor: params.cursor,
  });
  if (cursor) conditions.push(cursor);

  if (params.status === 'active') {
    conditions.push(isNull(provisionerTokens.revokedAt));
    const activeExpiry = or(
      isNull(provisionerTokens.expiresAt),
      gt(provisionerTokens.expiresAt, sql`now()`),
    );
    if (activeExpiry) conditions.push(activeExpiry);
  }
  if (params.status === 'expired') {
    conditions.push(
      isNull(provisionerTokens.revokedAt),
      isNotNull(provisionerTokens.expiresAt),
      lte(provisionerTokens.expiresAt, sql`now()`),
    );
  }
  if (params.status === 'revoked') conditions.push(isNotNull(provisionerTokens.revokedAt));

  const rows = await db()
    .select()
    .from(provisionerTokens)
    .where(and(...conditions))
    .orderBy(desc(provisionerTokens.createdAt), desc(provisionerTokens.id))
    .limit(params.limit + 1);
  const pageRows = rows.length > params.limit ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1);
  return {
    tokens: pageRows.map(toProvisionerToken),
    nextCursor:
      rows.length > params.limit && last ? {createdAt: last.createdAt, id: last.id} : null,
  };
}

export async function listUsableProvisionerTokensByWorkspaceId(
  workspaceId: string,
): Promise<ProvisionerToken[]> {
  const now = new Date();
  const rows = await db()
    .select()
    .from(provisionerTokens)
    .where(
      and(
        eq(provisionerTokens.workspaceId, workspaceId),
        eq(provisionerTokens.scope, 'workspace'),
        isNull(provisionerTokens.revokedAt),
        or(isNull(provisionerTokens.expiresAt), gt(provisionerTokens.expiresAt, now)),
      ),
    )
    .orderBy(desc(provisionerTokens.createdAt), desc(provisionerTokens.id));

  return rows.map(toProvisionerToken);
}

export async function resolveProvisionerTokenByHash(
  hashedToken: string,
): Promise<ProvisionerToken | undefined> {
  const rows = await db()
    .select()
    .from(provisionerTokens)
    .where(eq(provisionerTokens.hashedToken, hashedToken))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toProvisionerToken(row);
}

export async function revokeProvisionerToken(params: {
  tokenId: string;
  workspaceId: string;
  revokedByUserId: string;
}): Promise<ProvisionerToken | undefined> {
  const rows = await db().transaction(async (tx) => {
    const rows = await tx
      .update(provisionerTokens)
      .set({revokedAt: new Date(), revokedByUserId: params.revokedByUserId, updatedAt: new Date()})
      .where(
        and(
          eq(provisionerTokens.id, params.tokenId),
          eq(provisionerTokens.workspaceId, params.workspaceId),
          eq(provisionerTokens.scope, 'workspace'),
          isNull(provisionerTokens.revokedAt),
        ),
      )
      .returning();
    if (rows[0]) await cascadeProvisionerRevocation(tx, params.tokenId);
    return rows;
  });

  const row = rows[0];
  if (row) return toProvisionerToken(row);

  const existingRows = await db()
    .select()
    .from(provisionerTokens)
    .where(
      and(
        eq(provisionerTokens.id, params.tokenId),
        eq(provisionerTokens.workspaceId, params.workspaceId),
        eq(provisionerTokens.scope, 'workspace'),
      ),
    )
    .limit(1);

  const existingRow = existingRows[0];
  if (!existingRow) return undefined;
  return toProvisionerToken(existingRow);
}

export async function touchProvisionerLastSeen(params: {
  tokenId: string;
  throttleSeconds: number;
}): Promise<void> {
  await db()
    .update(provisionerTokens)
    .set({lastSeenAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(provisionerTokens.id, params.tokenId),
        or(
          isNull(provisionerTokens.lastSeenAt),
          sql`${provisionerTokens.lastSeenAt} < now() - (${params.throttleSeconds} || ' seconds')::interval`,
        ),
      ),
    );
}

export async function listActiveProvisionerTokens(params: {
  workspaceId: string;
  windowSeconds: number;
}): Promise<ActiveProvisionerToken[]> {
  const rows = await db()
    .select()
    .from(provisionerTokens)
    .where(
      and(
        eq(provisionerTokens.workspaceId, params.workspaceId),
        eq(provisionerTokens.scope, 'workspace'),
        isNull(provisionerTokens.revokedAt),
        or(isNull(provisionerTokens.expiresAt), gt(provisionerTokens.expiresAt, sql`now()`)),
        sql`${provisionerTokens.lastSeenAt} > now() - (${params.windowSeconds} || ' seconds')::interval`,
      ),
    )
    .orderBy(desc(provisionerTokens.lastSeenAt), desc(provisionerTokens.id));

  return rows.map(toProvisionerToken).filter((token): token is ActiveProvisionerToken => {
    return token.lastSeenAt !== null;
  });
}
