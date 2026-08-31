import {and, asc, eq, gt, inArray, isNull, lt, sql} from 'drizzle-orm';
import type {
  AgentAuthorizationCode,
  AgentAuthorizationRequest,
  AgentClient,
  AgentGrant,
  AgentPersonalAccessToken,
  AgentRefreshToken,
} from '#core/entities/agent-access.js';
import {db} from './db.js';
import {
  agentAuthorizationCodes,
  agentAuthorizationRequests,
  agentClients,
  agentGrants,
  agentPersonalAccessTokens,
  agentRefreshTokens,
  toAgentAuthorizationCode,
  toAgentAuthorizationRequest,
  toAgentClient,
  toAgentGrant,
  toAgentPersonalAccessToken,
  toAgentRefreshToken,
} from './schema/agent-access.js';

export type AgentAccessTx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

type AgentAccessExecutor = ReturnType<typeof db> | AgentAccessTx;

export interface CreateAgentClientParams {
  clientId: string;
  name: string;
  redirectUris: string[];
  kind: 'registered' | 'cimd';
}

export async function createAgentClient(params: CreateAgentClientParams): Promise<AgentClient> {
  return await db().transaction((tx) => createAgentClientTx(tx, params));
}

export async function createAgentClientTx(
  tx: AgentAccessTx,
  params: CreateAgentClientParams,
): Promise<AgentClient> {
  const rows = await tx
    .insert(agentClients)
    .values(params)
    .onConflictDoUpdate({
      target: agentClients.clientId,
      set: {
        lastSeenAt: sql`now()`,
        unreferencedAt: null,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error('Upsert returned no rows');
  return toAgentClient(row);
}

export async function findAgentClientByClientId(params: {
  clientId: string;
  executor?: AgentAccessExecutor;
}): Promise<AgentClient | undefined> {
  const executor = params.executor ?? db();
  const rows = await executor
    .select()
    .from(agentClients)
    .where(eq(agentClients.clientId, params.clientId))
    .limit(1);
  const row = rows[0];
  return row ? toAgentClient(row) : undefined;
}

export async function markAgentClientReferenced(
  tx: AgentAccessTx,
  params: {clientUuid: string},
): Promise<void> {
  await tx
    .update(agentClients)
    .set({unreferencedAt: null, lastSeenAt: sql`now()`, updatedAt: sql`now()`})
    .where(eq(agentClients.id, params.clientUuid));
}

export async function markAgentClientUnreferenced(
  tx: AgentAccessTx,
  params: {clientUuid: string},
): Promise<void> {
  await tx
    .update(agentClients)
    .set({unreferencedAt: sql`now()`, updatedAt: sql`now()`})
    .where(eq(agentClients.id, params.clientUuid));
}

export interface CreateAgentAuthorizationRequestParams {
  /** Internal `auth_agent_clients.id`, not the public OAuth `client_id`. */
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
  codeChallenge: string;
  state: string | null;
  expiresAt: Date;
}

export async function createAgentAuthorizationRequest(
  params: CreateAgentAuthorizationRequestParams,
): Promise<AgentAuthorizationRequest> {
  return await db().transaction((tx) => createAgentAuthorizationRequestTx(tx, params));
}

export async function createAgentAuthorizationRequestTx(
  tx: AgentAccessTx,
  params: CreateAgentAuthorizationRequestParams,
): Promise<AgentAuthorizationRequest> {
  const rows = await tx.insert(agentAuthorizationRequests).values(params).returning();
  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toAgentAuthorizationRequest(row);
}

export async function findPendingAgentAuthorizationRequest(params: {
  id: string;
  executor?: AgentAccessExecutor;
}): Promise<AgentAuthorizationRequest | undefined> {
  const executor = params.executor ?? db();
  const rows = await executor
    .select()
    .from(agentAuthorizationRequests)
    .where(
      and(
        eq(agentAuthorizationRequests.id, params.id),
        isNull(agentAuthorizationRequests.consumedAt),
        gt(agentAuthorizationRequests.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? toAgentAuthorizationRequest(row) : undefined;
}

export async function consumeAgentAuthorizationRequest(params: {
  id: string;
}): Promise<AgentAuthorizationRequest | undefined> {
  return await db().transaction((tx) => consumeAgentAuthorizationRequestTx(tx, params));
}

/**
 * Claims a pending request in the caller's transaction. The expiry and
 * consumed-at predicates are part of the update so concurrent approval and
 * denial can have only one winner.
 */
export async function consumeAgentAuthorizationRequestTx(
  tx: AgentAccessTx,
  params: {id: string},
): Promise<AgentAuthorizationRequest | undefined> {
  const rows = await tx
    .update(agentAuthorizationRequests)
    .set({consumedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(agentAuthorizationRequests.id, params.id),
        isNull(agentAuthorizationRequests.consumedAt),
        gt(agentAuthorizationRequests.expiresAt, sql`now()`),
      ),
    )
    .returning();
  const row = rows[0];
  return row ? toAgentAuthorizationRequest(row) : undefined;
}

export interface CreateAgentGrantParams {
  userId: string;
  workspaceId: string;
  /** Internal `auth_agent_clients.id`, not the public OAuth `client_id`. */
  clientId: string;
  scopes: string[];
}

export async function createAgentGrant(params: CreateAgentGrantParams): Promise<AgentGrant> {
  return await db().transaction((tx) => createAgentGrantTx(tx, params));
}

export async function createAgentGrantTx(
  tx: AgentAccessTx,
  params: CreateAgentGrantParams,
): Promise<AgentGrant> {
  const rows = await tx
    .insert(agentGrants)
    .values(params)
    .onConflictDoUpdate({
      target: [agentGrants.userId, agentGrants.workspaceId, agentGrants.clientId],
      targetWhere: sql`${agentGrants.revokedAt} IS NULL AND ${agentGrants.terminalAt} IS NULL`,
      set: {
        scopes: params.scopes,
        revokedAt: null,
        terminalAt: null,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error('Upsert returned no rows');

  await markAgentClientReferenced(tx, {clientUuid: params.clientId});
  return toAgentGrant(row);
}

export async function findAgentGrant(params: {
  id: string;
  executor?: AgentAccessExecutor;
}): Promise<AgentGrant | undefined> {
  const executor = params.executor ?? db();
  const rows = await executor
    .select()
    .from(agentGrants)
    .where(eq(agentGrants.id, params.id))
    .limit(1);
  const row = rows[0];
  return row ? toAgentGrant(row) : undefined;
}

/**
 * Locks one grant row until the surrounding transaction ends. Code exchange
 * and lifecycle transitions must use this same primitive before inspecting or
 * changing grant state. Callers must keep the transaction database-only while
 * this lock is held; external I/O must happen after commit.
 */
export async function lockAgentGrant(
  tx: AgentAccessTx,
  params: {grantId: string},
): Promise<AgentGrant | undefined> {
  const rows = await tx
    .select()
    .from(agentGrants)
    .where(eq(agentGrants.id, params.grantId))
    .for('update')
    .limit(1);
  const row = rows[0];
  return row ? toAgentGrant(row) : undefined;
}

export interface CreateAgentAuthorizationCodeParams {
  grantId: string;
  hashedCode: string;
  codeChallenge: string;
  redirectUri: string;
  resource: string;
  expiresAt: Date;
}

export async function createAgentAuthorizationCode(
  params: CreateAgentAuthorizationCodeParams,
): Promise<AgentAuthorizationCode> {
  return await db().transaction((tx) => createAgentAuthorizationCodeTx(tx, params));
}

export async function createAgentAuthorizationCodeTx(
  tx: AgentAccessTx,
  params: CreateAgentAuthorizationCodeParams,
): Promise<AgentAuthorizationCode> {
  const rows = await tx.insert(agentAuthorizationCodes).values(params).returning();
  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toAgentAuthorizationCode(row);
}

export async function findAgentAuthorizationCodeByHash(params: {
  hashedCode: string;
  executor?: AgentAccessExecutor;
}): Promise<AgentAuthorizationCode | undefined> {
  const executor = params.executor ?? db();
  const rows = await executor
    .select()
    .from(agentAuthorizationCodes)
    .where(eq(agentAuthorizationCodes.hashedCode, params.hashedCode))
    .limit(1);
  const row = rows[0];
  return row ? toAgentAuthorizationCode(row) : undefined;
}

export async function findActiveAgentAuthorizationCodeByHash(params: {
  hashedCode: string;
  executor?: AgentAccessExecutor;
}): Promise<AgentAuthorizationCode | undefined> {
  const executor = params.executor ?? db();
  const rows = await executor
    .select()
    .from(agentAuthorizationCodes)
    .where(
      and(
        eq(agentAuthorizationCodes.hashedCode, params.hashedCode),
        isNull(agentAuthorizationCodes.consumedAt),
        gt(agentAuthorizationCodes.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? toAgentAuthorizationCode(row) : undefined;
}

export async function consumeAgentAuthorizationCode(params: {
  hashedCode: string;
}): Promise<AgentAuthorizationCode | undefined> {
  return await db().transaction((tx) => consumeAgentAuthorizationCodeTx(tx, params));
}

/** Claims an authorization code exactly once, including its 60-second TTL. */
export async function consumeAgentAuthorizationCodeTx(
  tx: AgentAccessTx,
  params: {hashedCode: string},
): Promise<AgentAuthorizationCode | undefined> {
  const rows = await tx
    .update(agentAuthorizationCodes)
    .set({consumedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(agentAuthorizationCodes.hashedCode, params.hashedCode),
        isNull(agentAuthorizationCodes.consumedAt),
        gt(agentAuthorizationCodes.expiresAt, sql`now()`),
      ),
    )
    .returning();
  const row = rows[0];
  return row ? toAgentAuthorizationCode(row) : undefined;
}

export interface CreateAgentRefreshTokenParams {
  grantId: string;
  hashedToken: string;
  expiresAt: Date;
}

export async function createAgentRefreshToken(
  params: CreateAgentRefreshTokenParams,
): Promise<AgentRefreshToken> {
  return await db().transaction((tx) => createAgentRefreshTokenTx(tx, params));
}

export async function createAgentRefreshTokenTx(
  tx: AgentAccessTx,
  params: CreateAgentRefreshTokenParams,
): Promise<AgentRefreshToken> {
  const rows = await tx.insert(agentRefreshTokens).values(params).returning();
  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toAgentRefreshToken(row);
}

export async function findAgentRefreshTokenByHash(params: {
  hashedToken: string;
  executor?: AgentAccessExecutor;
}): Promise<AgentRefreshToken | undefined> {
  const executor = params.executor ?? db();
  const rows = await executor
    .select()
    .from(agentRefreshTokens)
    .where(eq(agentRefreshTokens.hashedToken, params.hashedToken))
    .limit(1);
  const row = rows[0];
  return row ? toAgentRefreshToken(row) : undefined;
}

export async function findActiveAgentRefreshTokenByHash(params: {
  hashedToken: string;
  executor?: AgentAccessExecutor;
}): Promise<AgentRefreshToken | undefined> {
  const executor = params.executor ?? db();
  const rows = await executor
    .select()
    .from(agentRefreshTokens)
    .where(
      and(
        eq(agentRefreshTokens.hashedToken, params.hashedToken),
        isNull(agentRefreshTokens.rotatedAt),
        isNull(agentRefreshTokens.revokedAt),
        gt(agentRefreshTokens.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? toAgentRefreshToken(row) : undefined;
}

/** Rotates a refresh token atomically; a concurrent rotation cannot win twice. */
export async function rotateAgentRefreshToken(params: {
  hashedToken: string;
  replacementHashedToken: string;
  replacementExpiresAt: Date;
}): Promise<AgentRefreshToken | undefined> {
  return await db().transaction((tx) => rotateAgentRefreshTokenTx(tx, params));
}

export async function rotateAgentRefreshTokenTx(
  tx: AgentAccessTx,
  params: {
    hashedToken: string;
    replacementHashedToken: string;
    replacementExpiresAt: Date;
  },
): Promise<AgentRefreshToken | undefined> {
  const rows = await tx
    .update(agentRefreshTokens)
    .set({rotatedAt: sql`now()`, lastUsedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(agentRefreshTokens.hashedToken, params.hashedToken),
        isNull(agentRefreshTokens.rotatedAt),
        isNull(agentRefreshTokens.revokedAt),
        gt(agentRefreshTokens.expiresAt, sql`now()`),
      ),
    )
    .returning();
  const row = rows[0];
  if (!row) return undefined;

  return await createAgentRefreshTokenTx(tx, {
    grantId: row.grantId,
    hashedToken: params.replacementHashedToken,
    expiresAt: params.replacementExpiresAt,
  });
}

export async function revokeAgentRefreshToken(params: {
  id: string;
}): Promise<AgentRefreshToken | undefined> {
  return await db().transaction(async (tx) => {
    const rows = await tx
      .update(agentRefreshTokens)
      .set({revokedAt: sql`now()`, updatedAt: sql`now()`})
      .where(and(eq(agentRefreshTokens.id, params.id), isNull(agentRefreshTokens.revokedAt)))
      .returning();
    const row = rows[0];
    return row ? toAgentRefreshToken(row) : undefined;
  });
}

export interface CreateAgentPersonalAccessTokenParams {
  userId: string;
  workspaceId: string;
  hashedToken: string;
  prefix: string;
  name: string;
  scopes: string[];
  expiresAt: Date;
}

export async function createAgentPersonalAccessToken(
  params: CreateAgentPersonalAccessTokenParams,
): Promise<AgentPersonalAccessToken> {
  return await db().transaction((tx) => createAgentPersonalAccessTokenTx(tx, params));
}

export async function createAgentPersonalAccessTokenTx(
  tx: AgentAccessTx,
  params: CreateAgentPersonalAccessTokenParams,
): Promise<AgentPersonalAccessToken> {
  const rows = await tx.insert(agentPersonalAccessTokens).values(params).returning();
  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toAgentPersonalAccessToken(row);
}

export async function findAgentPersonalAccessTokenByHash(params: {
  hashedToken: string;
  executor?: AgentAccessExecutor;
}): Promise<AgentPersonalAccessToken | undefined> {
  const executor = params.executor ?? db();
  const rows = await executor
    .select()
    .from(agentPersonalAccessTokens)
    .where(eq(agentPersonalAccessTokens.hashedToken, params.hashedToken))
    .limit(1);
  const row = rows[0];
  return row ? toAgentPersonalAccessToken(row) : undefined;
}

export async function findActiveAgentPersonalAccessTokenByHash(params: {
  hashedToken: string;
  executor?: AgentAccessExecutor;
}): Promise<AgentPersonalAccessToken | undefined> {
  const executor = params.executor ?? db();
  const rows = await executor
    .select()
    .from(agentPersonalAccessTokens)
    .where(
      and(
        eq(agentPersonalAccessTokens.hashedToken, params.hashedToken),
        isNull(agentPersonalAccessTokens.revokedAt),
        gt(agentPersonalAccessTokens.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? toAgentPersonalAccessToken(row) : undefined;
}

export async function markAgentPersonalAccessTokenUsed(params: {
  id: string;
}): Promise<AgentPersonalAccessToken | undefined> {
  const rows = await db()
    .update(agentPersonalAccessTokens)
    .set({lastUsedAt: sql`now()`, updatedAt: sql`now()`})
    .where(eq(agentPersonalAccessTokens.id, params.id))
    .returning();
  const row = rows[0];
  return row ? toAgentPersonalAccessToken(row) : undefined;
}

export async function revokeAgentPersonalAccessToken(params: {
  id: string;
}): Promise<AgentPersonalAccessToken | undefined> {
  const rows = await db()
    .update(agentPersonalAccessTokens)
    .set({revokedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(eq(agentPersonalAccessTokens.id, params.id), isNull(agentPersonalAccessTokens.revokedAt)),
    )
    .returning();
  const row = rows[0];
  return row ? toAgentPersonalAccessToken(row) : undefined;
}

export interface PruneAgentAccessParams {
  retentionDays?: number;
  limit?: number;
  now?: Date;
}

/** Deletes terminal credentials and ephemeral authorization rows in bounded batches. */
export async function pruneAgentAccess(params: PruneAgentAccessParams = {}): Promise<number> {
  const now = params.now ?? new Date();
  const retentionDays = params.retentionDays ?? 7;
  const limit = params.limit ?? 1000;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  return await db().transaction(async (tx) => {
    const requestIds = tx
      .select({id: agentAuthorizationRequests.id})
      .from(agentAuthorizationRequests)
      .where(
        lt(
          sql`coalesce(${agentAuthorizationRequests.consumedAt}, ${agentAuthorizationRequests.expiresAt})`,
          cutoff,
        ),
      )
      .orderBy(asc(agentAuthorizationRequests.expiresAt), asc(agentAuthorizationRequests.id))
      .limit(limit);
    const codeIds = tx
      .select({id: agentAuthorizationCodes.id})
      .from(agentAuthorizationCodes)
      .where(
        lt(
          sql`coalesce(${agentAuthorizationCodes.consumedAt}, ${agentAuthorizationCodes.expiresAt})`,
          cutoff,
        ),
      )
      .orderBy(asc(agentAuthorizationCodes.expiresAt), asc(agentAuthorizationCodes.id))
      .limit(limit);
    const refreshTokenIds = tx
      .select({id: agentRefreshTokens.id})
      .from(agentRefreshTokens)
      .where(lt(agentRefreshTokens.expiresAt, cutoff))
      .orderBy(asc(agentRefreshTokens.expiresAt), asc(agentRefreshTokens.id))
      .limit(limit);
    const patIds = tx
      .select({id: agentPersonalAccessTokens.id})
      .from(agentPersonalAccessTokens)
      .where(lt(agentPersonalAccessTokens.expiresAt, cutoff))
      .orderBy(asc(agentPersonalAccessTokens.expiresAt), asc(agentPersonalAccessTokens.id))
      .limit(limit);

    const [requests, codes, refreshTokens, pats] = await Promise.all([
      tx
        .delete(agentAuthorizationRequests)
        .where(inArray(agentAuthorizationRequests.id, requestIds))
        .returning({id: agentAuthorizationRequests.id}),
      tx
        .delete(agentAuthorizationCodes)
        .where(inArray(agentAuthorizationCodes.id, codeIds))
        .returning({id: agentAuthorizationCodes.id}),
      tx
        .delete(agentRefreshTokens)
        .where(inArray(agentRefreshTokens.id, refreshTokenIds))
        .returning({id: agentRefreshTokens.id}),
      tx
        .delete(agentPersonalAccessTokens)
        .where(inArray(agentPersonalAccessTokens.id, patIds))
        .returning({id: agentPersonalAccessTokens.id}),
    ]);
    return requests.length + codes.length + refreshTokens.length + pats.length;
  });
}
