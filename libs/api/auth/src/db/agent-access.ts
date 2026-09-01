import {and, asc, eq, gt, inArray, isNull, lte, notExists, or, sql} from 'drizzle-orm';
import type {
  AgentAuthorizationCode,
  AgentAuthorizationRequest,
  AgentClient,
  AgentGrant,
  AgentPersonalAccessToken,
  AgentRefreshToken,
} from '#core/entities/agent-access.js';
import {
  AGENT_AUTHORIZATION_RETENTION_DAYS,
  AGENT_CLIENT_RETENTION_DAYS,
  AGENT_GRANT_RETENTION_DAYS,
  AGENT_PAT_RETENTION_DAYS,
  AGENT_REFRESH_TOKEN_RETENTION_DAYS,
} from './agent-access-retention.js';
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
import {users} from './schema/users.js';

export type AgentAccessTx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

type AgentAccessExecutor = ReturnType<typeof db> | AgentAccessTx;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function retentionCutoff(now: Date, days: number): Date {
  if (!Number.isFinite(days) || days < 0) {
    throw new Error('Agent-access retention must be a non-negative finite number of days');
  }
  return new Date(now.getTime() - days * MILLISECONDS_PER_DAY);
}

function batchLimit(limit: number | undefined): number {
  const value = limit ?? 1000;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('Agent-access batch limit must be a positive integer');
  }
  return value;
}

async function requireActiveAgentGrant(tx: AgentAccessTx, grantId: string): Promise<AgentGrant> {
  const grant = await lockAgentGrant(tx, {grantId});
  if (!grant) throw new Error(`Agent grant ${grantId} was not found`);
  if (grant.revokedAt || grant.terminalAt) {
    throw new Error(`Agent grant ${grantId} is no longer active`);
  }
  return grant;
}

async function isActiveUser(tx: AgentAccessTx, userId: string): Promise<boolean> {
  const rows = await tx
    .select({id: users.id})
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, 'active')))
    .limit(1);
  return rows.length > 0;
}

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
    .where(
      and(
        eq(agentClients.id, params.clientUuid),
        notExists(
          tx
            .select({id: agentGrants.id})
            .from(agentGrants)
            .where(eq(agentGrants.clientId, params.clientUuid)),
        ),
      ),
    );
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
        updatedAt: sql`now()`,
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error('Upsert returned no rows');

  // Refresh tokens derive their scopes from the grant. Reauthorization must
  // invalidate existing tokens before the grant's scopes can be widened.
  await tx
    .update(agentRefreshTokens)
    .set({revokedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(agentRefreshTokens.grantId, row.id),
        isNull(agentRefreshTokens.rotatedAt),
        isNull(agentRefreshTokens.revokedAt),
      ),
    );

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
  await requireActiveAgentGrant(tx, params.grantId);
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
  // Read the binding before taking the grant lock. The conditional update below
  // re-checks consumed_at and expiry after the lock, so concurrent exchanges
  // still have exactly one winner even when both read the code first.
  const existingRows = await tx
    .select()
    .from(agentAuthorizationCodes)
    .where(eq(agentAuthorizationCodes.hashedCode, params.hashedCode))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) return undefined;

  const grant = await lockAgentGrant(tx, {grantId: existing.grantId});
  if (!grant || grant.revokedAt || grant.terminalAt) return undefined;
  if (!(await isActiveUser(tx, grant.userId))) return undefined;

  const rows = await tx
    .update(agentAuthorizationCodes)
    .set({consumedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(agentAuthorizationCodes.id, existing.id),
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
  await requireActiveAgentGrant(tx, params.grantId);
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
    .where(
      and(
        eq(agentRefreshTokens.hashedToken, params.hashedToken),
        isNull(agentRefreshTokens.revokedAt),
      ),
    )
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

/** Finds the one live refresh token currently attached to a grant. */
export async function findActiveAgentRefreshTokenByGrantId(params: {
  grantId: string;
  executor?: AgentAccessExecutor;
}): Promise<AgentRefreshToken | undefined> {
  const executor = params.executor ?? db();
  const rows = await executor
    .select()
    .from(agentRefreshTokens)
    .where(
      and(
        eq(agentRefreshTokens.grantId, params.grantId),
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
  const existingRows = await tx
    .select()
    .from(agentRefreshTokens)
    .where(
      and(
        eq(agentRefreshTokens.hashedToken, params.hashedToken),
        isNull(agentRefreshTokens.revokedAt),
      ),
    )
    .limit(1);
  const existing = existingRows[0];
  if (!existing) return undefined;

  const grant = await lockAgentGrant(tx, {grantId: existing.grantId});
  if (!grant || grant.revokedAt || grant.terminalAt) return undefined;
  if (!(await isActiveUser(tx, grant.userId))) return undefined;

  const rows = await tx
    .update(agentRefreshTokens)
    .set({rotatedAt: sql`now()`, lastUsedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(agentRefreshTokens.id, existing.id),
        eq(agentRefreshTokens.hashedToken, params.hashedToken),
        isNull(agentRefreshTokens.rotatedAt),
        isNull(agentRefreshTokens.revokedAt),
        gt(agentRefreshTokens.expiresAt, sql`now()`),
      ),
    )
    .returning();
  const row = rows[0];
  if (!row) return undefined;

  await tx
    .update(agentGrants)
    .set({lastUsedAt: sql`now()`, updatedAt: sql`now()`})
    .where(eq(agentGrants.id, row.grantId));

  const successorRows = await tx
    .insert(agentRefreshTokens)
    .values({
      grantId: row.grantId,
      hashedToken: params.replacementHashedToken,
      expiresAt: params.replacementExpiresAt,
    })
    .returning();
  const successor = successorRows[0];
  if (!successor) throw new Error('Insert returned no rows');
  return toAgentRefreshToken(successor);
}

export async function revokeAgentRefreshToken(params: {
  id: string;
}): Promise<AgentRefreshToken | undefined> {
  return await db().transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(agentRefreshTokens)
      .where(eq(agentRefreshTokens.id, params.id))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) return undefined;
    const grant = await lockAgentGrant(tx, {grantId: existing.grantId});
    if (!grant) return undefined;

    const rows = await tx
      .update(agentRefreshTokens)
      .set({revokedAt: sql`now()`, updatedAt: sql`now()`})
      .where(and(eq(agentRefreshTokens.id, params.id), isNull(agentRefreshTokens.revokedAt)))
      .returning();
    const row = rows[0];
    return row ? toAgentRefreshToken(row) : undefined;
  });
}

/** Revokes a grant and every refresh-token generation in its family. */
export async function revokeAgentGrant(params: {grantId: string}): Promise<AgentGrant | undefined> {
  return await db().transaction((tx) => revokeAgentGrantTx(tx, params));
}

export async function revokeAgentGrantTx(
  tx: AgentAccessTx,
  params: {grantId: string},
): Promise<AgentGrant | undefined> {
  const grant = await lockAgentGrant(tx, params);
  if (!grant) return undefined;

  const rows = await tx
    .update(agentGrants)
    .set({
      revokedAt: grant.revokedAt ?? sql`now()`,
      terminalAt: grant.terminalAt ?? sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(agentGrants.id, grant.id))
    .returning();
  const updatedGrant = rows[0];
  if (!updatedGrant) return undefined;

  await tx
    .update(agentRefreshTokens)
    .set({revokedAt: sql`now()`, updatedAt: sql`now()`})
    .where(and(eq(agentRefreshTokens.grantId, grant.id), isNull(agentRefreshTokens.revokedAt)));

  return toAgentGrant(updatedGrant);
}

export interface TransitionAgentGrantsToTerminalParams {
  limit?: number;
  now?: Date;
}

/**
 * Marks grants terminal once they have no usable refresh token or authorization
 * code left. Each candidate is locked before its children are inspected so a
 * concurrent code exchange or token rotation cannot create a live child after
 * the decision.
 */
export async function transitionAgentGrantsToTerminal(
  params: TransitionAgentGrantsToTerminalParams = {},
): Promise<number> {
  return await db().transaction((tx) => transitionAgentGrantsToTerminalTx(tx, params));
}

export async function transitionAgentGrantsToTerminalTx(
  tx: AgentAccessTx,
  params: TransitionAgentGrantsToTerminalParams = {},
): Promise<number> {
  const limit = batchLimit(params.limit);
  const now = params.now ?? new Date();
  const candidates = await tx
    .select({id: agentGrants.id})
    .from(agentGrants)
    .where(isNull(agentGrants.terminalAt))
    .orderBy(asc(agentGrants.createdAt), asc(agentGrants.id))
    .limit(limit);

  let transitioned = 0;
  for (const candidate of candidates) {
    const grant = await lockAgentGrant(tx, {grantId: candidate.id});
    if (!grant || grant.terminalAt) continue;

    if (!grant.revokedAt) {
      const liveRefreshTokens = await tx
        .select({id: agentRefreshTokens.id})
        .from(agentRefreshTokens)
        .where(
          and(
            eq(agentRefreshTokens.grantId, grant.id),
            isNull(agentRefreshTokens.rotatedAt),
            isNull(agentRefreshTokens.revokedAt),
            gt(agentRefreshTokens.expiresAt, now),
          ),
        )
        .limit(1);
      if (liveRefreshTokens.length > 0) continue;

      const liveAuthorizationCodes = await tx
        .select({id: agentAuthorizationCodes.id})
        .from(agentAuthorizationCodes)
        .where(
          and(
            eq(agentAuthorizationCodes.grantId, grant.id),
            isNull(agentAuthorizationCodes.consumedAt),
            gt(agentAuthorizationCodes.expiresAt, now),
          ),
        )
        .limit(1);
      if (liveAuthorizationCodes.length > 0) continue;
    }

    const rows = await tx
      .update(agentGrants)
      .set({terminalAt: now, updatedAt: now})
      .where(and(eq(agentGrants.id, grant.id), isNull(agentGrants.terminalAt)))
      .returning({id: agentGrants.id});
    if (rows.length > 0) transitioned += 1;
  }

  return transitioned;
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
    .select({token: agentPersonalAccessTokens})
    .from(agentPersonalAccessTokens)
    .innerJoin(users, eq(agentPersonalAccessTokens.userId, users.id))
    .where(
      and(
        eq(agentPersonalAccessTokens.hashedToken, params.hashedToken),
        isNull(agentPersonalAccessTokens.revokedAt),
        gt(agentPersonalAccessTokens.expiresAt, sql`now()`),
        eq(users.status, 'active'),
      ),
    )
    .limit(1);
  const row = rows[0]?.token;
  return row ? toAgentPersonalAccessToken(row) : undefined;
}

export async function markAgentPersonalAccessTokenUsed(params: {
  id: string;
  throttleSeconds?: number;
}): Promise<AgentPersonalAccessToken | undefined> {
  const throttleSeconds = params.throttleSeconds ?? 60;
  if (!Number.isFinite(throttleSeconds) || throttleSeconds < 0) {
    throw new Error('PAT last-used throttle must be a non-negative finite number of seconds');
  }

  const rows = await db()
    .update(agentPersonalAccessTokens)
    .set({lastUsedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(agentPersonalAccessTokens.id, params.id),
        isNull(agentPersonalAccessTokens.revokedAt),
        gt(agentPersonalAccessTokens.expiresAt, sql`now()`),
        or(
          isNull(agentPersonalAccessTokens.lastUsedAt),
          lte(
            agentPersonalAccessTokens.lastUsedAt,
            sql`now() - (${throttleSeconds} || ' seconds')::interval`,
          ),
        ),
      ),
    )
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
  /** Overrides every retention horizon for deterministic maintenance tests. */
  retentionDays?: number;
  limit?: number;
  now?: Date;
}

interface AgentAccessRetentionCutoffs {
  authorization: Date;
  refreshToken: Date;
  grant: Date;
  pat: Date;
  client: Date;
}

async function deleteExpiredAgentAuthorizationRequests(
  tx: AgentAccessTx,
  cutoff: Date,
  limit: number,
): Promise<number> {
  const candidates = await tx
    .select({id: agentAuthorizationRequests.id})
    .from(agentAuthorizationRequests)
    .where(lte(agentAuthorizationRequests.expiresAt, cutoff))
    .orderBy(asc(agentAuthorizationRequests.expiresAt), asc(agentAuthorizationRequests.id))
    .limit(limit);
  if (candidates.length === 0) return 0;

  const rows = await tx
    .delete(agentAuthorizationRequests)
    .where(
      inArray(
        agentAuthorizationRequests.id,
        candidates.map(({id}) => id),
      ),
    )
    .returning({id: agentAuthorizationRequests.id});
  return rows.length;
}

async function deleteExpiredAgentAuthorizationCodes(
  tx: AgentAccessTx,
  cutoff: Date,
  limit: number,
): Promise<number> {
  const candidates = await tx
    .select({id: agentAuthorizationCodes.id})
    .from(agentAuthorizationCodes)
    .where(lte(agentAuthorizationCodes.expiresAt, cutoff))
    .orderBy(asc(agentAuthorizationCodes.expiresAt), asc(agentAuthorizationCodes.id))
    .limit(limit);
  if (candidates.length === 0) return 0;

  const rows = await tx
    .delete(agentAuthorizationCodes)
    .where(
      inArray(
        agentAuthorizationCodes.id,
        candidates.map(({id}) => id),
      ),
    )
    .returning({id: agentAuthorizationCodes.id});
  return rows.length;
}

async function deleteRetainedAgentRefreshTokens(
  tx: AgentAccessTx,
  cutoff: Date,
  limit: number,
): Promise<number> {
  const candidates = await tx
    .select({id: agentRefreshTokens.id})
    .from(agentRefreshTokens)
    .where(
      or(
        lte(agentRefreshTokens.rotatedAt, cutoff),
        lte(agentRefreshTokens.revokedAt, cutoff),
        and(
          isNull(agentRefreshTokens.rotatedAt),
          isNull(agentRefreshTokens.revokedAt),
          lte(agentRefreshTokens.expiresAt, cutoff),
        ),
      ),
    )
    .orderBy(asc(agentRefreshTokens.expiresAt), asc(agentRefreshTokens.id))
    .limit(limit);
  if (candidates.length === 0) return 0;

  const rows = await tx
    .delete(agentRefreshTokens)
    .where(
      inArray(
        agentRefreshTokens.id,
        candidates.map(({id}) => id),
      ),
    )
    .returning({id: agentRefreshTokens.id});
  return rows.length;
}

async function deleteRetainedAgentPersonalAccessTokens(
  tx: AgentAccessTx,
  cutoff: Date,
  limit: number,
): Promise<number> {
  const candidates = await tx
    .select({id: agentPersonalAccessTokens.id})
    .from(agentPersonalAccessTokens)
    .where(
      or(
        lte(agentPersonalAccessTokens.revokedAt, cutoff),
        and(
          isNull(agentPersonalAccessTokens.revokedAt),
          lte(agentPersonalAccessTokens.expiresAt, cutoff),
        ),
      ),
    )
    .orderBy(asc(agentPersonalAccessTokens.expiresAt), asc(agentPersonalAccessTokens.id))
    .limit(limit);
  if (candidates.length === 0) return 0;

  const rows = await tx
    .delete(agentPersonalAccessTokens)
    .where(
      inArray(
        agentPersonalAccessTokens.id,
        candidates.map(({id}) => id),
      ),
    )
    .returning({id: agentPersonalAccessTokens.id});
  return rows.length;
}

async function pruneTerminalAgentGrants(
  tx: AgentAccessTx,
  params: {cutoff: Date; now: Date; limit: number},
): Promise<number> {
  const candidates = await tx
    .select({id: agentGrants.id, clientId: agentGrants.clientId})
    .from(agentGrants)
    .where(lte(agentGrants.terminalAt, params.cutoff))
    .orderBy(asc(agentGrants.terminalAt), asc(agentGrants.id))
    .limit(params.limit)
    .for('update');
  if (candidates.length === 0) return 0;

  const grantIds = candidates.map(({id}) => id);
  const deletedCodes = await tx
    .delete(agentAuthorizationCodes)
    .where(inArray(agentAuthorizationCodes.grantId, grantIds))
    .returning({id: agentAuthorizationCodes.id});
  const deletedRefreshTokens = await tx
    .delete(agentRefreshTokens)
    .where(inArray(agentRefreshTokens.grantId, grantIds))
    .returning({id: agentRefreshTokens.id});
  const deletedGrants = await tx
    .delete(agentGrants)
    .where(inArray(agentGrants.id, grantIds))
    .returning({id: agentGrants.id, clientId: agentGrants.clientId});

  const clientIds = new Set(deletedGrants.map(({clientId}) => clientId));
  for (const clientId of clientIds) {
    const remainingGrants = await tx
      .select({id: agentGrants.id})
      .from(agentGrants)
      .where(eq(agentGrants.clientId, clientId))
      .limit(1);
    if (remainingGrants.length > 0) continue;

    await tx
      .update(agentClients)
      .set({
        unreferencedAt: sql`coalesce(${agentClients.unreferencedAt}, ${params.now})`,
        updatedAt: params.now,
      })
      .where(eq(agentClients.id, clientId));
  }

  return deletedCodes.length + deletedRefreshTokens.length + deletedGrants.length;
}

async function pruneUnreferencedAgentClients(
  tx: AgentAccessTx,
  cutoff: Date,
  limit: number,
): Promise<number> {
  const candidates = await tx
    .select({id: agentClients.id})
    .from(agentClients)
    .where(
      or(
        lte(agentClients.unreferencedAt, cutoff),
        and(
          isNull(agentClients.unreferencedAt),
          lte(agentClients.createdAt, cutoff),
          notExists(
            tx
              .select({id: agentGrants.id})
              .from(agentGrants)
              .where(eq(agentGrants.clientId, agentClients.id)),
          ),
        ),
      ),
    )
    .orderBy(asc(agentClients.unreferencedAt), asc(agentClients.createdAt), asc(agentClients.id))
    .limit(limit)
    .for('update');

  let deleted = 0;
  for (const {id} of candidates) {
    const remainingGrants = await tx
      .select({id: agentGrants.id})
      .from(agentGrants)
      .where(eq(agentGrants.clientId, id))
      .limit(1);
    if (remainingGrants.length > 0) continue;

    const rows = await tx
      .delete(agentClients)
      .where(
        and(
          eq(agentClients.id, id),
          or(
            lte(agentClients.unreferencedAt, cutoff),
            and(isNull(agentClients.unreferencedAt), lte(agentClients.createdAt, cutoff)),
          ),
        ),
      )
      .returning({id: agentClients.id});
    deleted += rows.length;
  }
  return deleted;
}

/**
 * Transitions inactive grants and deletes retained agent-access rows in bounded
 * batches. The caller can override the common horizon in tests; production uses
 * the per-row windows from the agent-access retention policy.
 */
export async function pruneAgentAccess(params: PruneAgentAccessParams = {}): Promise<number> {
  const now = params.now ?? new Date();
  const limit = batchLimit(params.limit);
  const retentionDays = params.retentionDays;
  const authorizationCutoff = retentionCutoff(
    now,
    retentionDays ?? AGENT_AUTHORIZATION_RETENTION_DAYS,
  );
  const refreshTokenCutoff = retentionCutoff(
    now,
    retentionDays ?? AGENT_REFRESH_TOKEN_RETENTION_DAYS,
  );
  const grantCutoff = retentionCutoff(now, retentionDays ?? AGENT_GRANT_RETENTION_DAYS);
  const patCutoff = retentionCutoff(now, retentionDays ?? AGENT_PAT_RETENTION_DAYS);
  const clientCutoff = retentionCutoff(now, retentionDays ?? AGENT_CLIENT_RETENTION_DAYS);
  const cutoffs: AgentAccessRetentionCutoffs = {
    authorization: authorizationCutoff,
    refreshToken: refreshTokenCutoff,
    grant: grantCutoff,
    pat: patCutoff,
    client: clientCutoff,
  };

  return await db().transaction(async (tx) => {
    // This runs first so grants whose last child expired can be terminalized in
    // the same maintenance tick. It takes the same grant row lock as code
    // exchange and refresh rotation.
    await transitionAgentGrantsToTerminalTx(tx, {limit, now});
    return (
      (await deleteExpiredAgentAuthorizationRequests(tx, cutoffs.authorization, limit)) +
      (await deleteExpiredAgentAuthorizationCodes(tx, cutoffs.authorization, limit)) +
      (await deleteRetainedAgentRefreshTokens(tx, cutoffs.refreshToken, limit)) +
      (await deleteRetainedAgentPersonalAccessTokens(tx, cutoffs.pat, limit)) +
      (await pruneTerminalAgentGrants(tx, {
        cutoff: cutoffs.grant,
        now,
        limit,
      })) +
      (await pruneUnreferencedAgentClients(tx, cutoffs.client, limit))
    );
  });
}
