import {and, asc, eq, gt, inArray, isNotNull, isNull, lte, notExists, or, sql} from 'drizzle-orm';
import {config} from '#config.js';
import type {
  AgentAuthorizationCode,
  AgentAuthorizationRequest,
  AgentClient,
  AgentGrant,
  AgentPersonalAccessToken,
  AgentRefreshToken,
} from '#core/entities/agent-access.js';
import {
  AGENT_ACCESS_RETENTION_TIMEOUT_MARGIN_MS,
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
const MILLISECONDS_PER_SECOND = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

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

class AgentAccessRetentionDeadlineExceededError extends Error {
  readonly code = '57014';

  constructor() {
    super('Agent-access retention deadline exceeded');
    this.name = 'AgentAccessRetentionDeadlineExceededError';
  }
}

function retentionStatementTimeoutMs(deadlineMs: number): number {
  if (!Number.isFinite(deadlineMs)) {
    throw new Error('Agent-access retention deadline must be a finite timestamp');
  }
  const remainingMs = Math.floor(
    deadlineMs - Date.now() - AGENT_ACCESS_RETENTION_TIMEOUT_MARGIN_MS,
  );
  if (remainingMs < 1) throw new AgentAccessRetentionDeadlineExceededError();
  return remainingMs;
}

async function prepareAgentAccessRetentionStatement(
  tx: AgentAccessTx,
  deadlineMs: number | undefined,
): Promise<void> {
  if (deadlineMs === undefined) return;
  const timeout = `${retentionStatementTimeoutMs(deadlineMs)}ms`;
  await tx.execute(
    sql`select set_config('statement_timeout', ${timeout}, true), set_config('lock_timeout', ${timeout}, true)`,
  );
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

/** Checks the authority-creating user state inside the caller's transaction. */
export async function isActiveAgentUserTx(
  tx: AgentAccessTx,
  params: {userId: string},
): Promise<boolean> {
  const rows = await tx
    .select({id: users.id})
    .from(users)
    .where(and(eq(users.id, params.userId), eq(users.status, 'active')))
    .for('update')
    .limit(1);
  return rows.length > 0;
}

export async function isActiveAgentUser(params: {userId: string}): Promise<boolean> {
  return await db().transaction((tx) => isActiveAgentUserTx(tx, params));
}

async function lockAgentClient(
  tx: AgentAccessTx,
  clientId: string,
): Promise<AgentClient | undefined> {
  const rows = await tx
    .select()
    .from(agentClients)
    .where(eq(agentClients.id, clientId))
    .for('update')
    .limit(1);
  const row = rows[0];
  return row ? toAgentClient(row) : undefined;
}

function validateRotationGraceSeconds(graceSeconds: number): number {
  if (!Number.isFinite(graceSeconds) || graceSeconds < 0) {
    throw new Error('Agent refresh rotation grace must be a non-negative finite number of seconds');
  }
  return graceSeconds;
}

/** Returns the default sliding lifetime for a newly issued agent refresh token. */
export function agentRefreshTokenExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + config.AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS * MILLISECONDS_PER_DAY);
}

/**
 * A rotated token remains usable for an access-token-only grace response. The
 * row must still exist; pruning deliberately turns later replays into plain
 * unknown-token responses.
 */
export function isWithinAgentRefreshRotationGrace(params: {
  rotatedAt: Date | null;
  now?: Date;
  graceSeconds?: number | undefined;
}): boolean {
  if (!params.rotatedAt) return false;
  const now = params.now ?? new Date();
  const graceSeconds = validateRotationGraceSeconds(
    params.graceSeconds ?? config.AUTH_REFRESH_ROTATION_GRACE_SECONDS,
  );
  const elapsedMs = now.getTime() - params.rotatedAt.getTime();
  return elapsedMs >= 0 && elapsedMs <= graceSeconds * MILLISECONDS_PER_SECOND;
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

export interface UpsertCimdAgentClientParams {
  clientId: string;
  name: string;
  redirectUris: string[];
}

/**
 * Stores the latest validated CIMD identity. The generic client upsert above
 * intentionally preserves registration metadata; CIMD documents are the
 * source of truth and therefore use this explicit update path.
 */
export async function upsertCimdAgentClient(
  params: UpsertCimdAgentClientParams,
): Promise<AgentClient> {
  return await db().transaction(async (tx) => {
    const rows = await tx
      .insert(agentClients)
      .values({...params, kind: 'cimd'})
      .onConflictDoUpdate({
        target: agentClients.clientId,
        set: {
          name: params.name,
          redirectUris: params.redirectUris,
          kind: 'cimd',
          lastSeenAt: sql`now()`,
          unreferencedAt: null,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('CIMD client upsert returned no row');
    return toAgentClient(row);
  });
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

/** Resolves a client by its private database id for stored OAuth artifacts. */
export async function findAgentClientById(params: {
  id: string;
  executor?: AgentAccessExecutor;
}): Promise<AgentClient | undefined> {
  const executor = params.executor ?? db();
  const rows = await executor
    .select()
    .from(agentClients)
    .where(eq(agentClients.id, params.id))
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
  if (!(await lockAgentClient(tx, params.clientId))) {
    throw new Error(`Agent client ${params.clientId} was not found`);
  }
  const rows = await tx.insert(agentAuthorizationRequests).values(params).returning();
  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toAgentAuthorizationRequest(row);
}

export async function findPendingAgentAuthorizationRequest(params: {
  id: string;
  executor?: AgentAccessExecutor;
}): Promise<AgentAuthorizationRequest | undefined> {
  if (!isUuid(params.id)) return undefined;
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
  if (!isUuid(params.id)) return undefined;
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

/**
 * Creates or reauthorizes a grant while holding its client row lock. A newly
 * created grant has no live child until its first authorization code or refresh
 * token is issued, so approval callers must compose that first child creation
 * with this Tx helper in one database transaction.
 */
export async function createAgentGrantTx(
  tx: AgentAccessTx,
  params: CreateAgentGrantParams,
): Promise<AgentGrant> {
  if (!(await lockAgentClient(tx, params.clientId))) {
    throw new Error(`Agent client ${params.clientId} was not found`);
  }
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
  /** Defaults to the configured 14-day lifetime. */
  expiresAt?: Date;
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
  const rows = await tx
    .insert(agentRefreshTokens)
    .values({...params, expiresAt: params.expiresAt ?? agentRefreshTokenExpiresAt()})
    .returning();
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

export type AgentRefreshTokenReplayResult =
  | {
      kind: 'grace';
      grant: AgentGrant;
      predecessor: AgentRefreshToken;
      successor: AgentRefreshToken;
    }
  | {
      kind: 'reused';
      grant: AgentGrant;
      predecessor: AgentRefreshToken;
    };

/**
 * Resolves a replay of a retained, rotated token. A grace hit returns the one
 * live successor so the caller can mint an access token without issuing a new
 * refresh cookie. A replay after grace revokes the complete grant family.
 * Missing or pruned rows return undefined and therefore remain plain 401s.
 */
export async function resolveAgentRefreshTokenReplay(params: {
  hashedToken: string;
  now?: Date;
  graceSeconds?: number;
}): Promise<AgentRefreshTokenReplayResult | undefined> {
  return await db().transaction((tx) => resolveAgentRefreshTokenReplayTx(tx, params));
}

export async function resolveAgentRefreshTokenReplayTx(
  tx: AgentAccessTx,
  params: {
    hashedToken: string;
    now?: Date;
    graceSeconds?: number;
  },
): Promise<AgentRefreshTokenReplayResult | undefined> {
  const rows = await tx
    .select()
    .from(agentRefreshTokens)
    .where(
      and(
        eq(agentRefreshTokens.hashedToken, params.hashedToken),
        isNull(agentRefreshTokens.revokedAt),
      ),
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) return undefined;

  const grant = await lockAgentGrant(tx, {grantId: existing.grantId});
  if (!grant || grant.revokedAt || grant.terminalAt) return undefined;
  if (!(await isActiveUser(tx, grant.userId))) return undefined;

  const currentRows = await tx
    .select()
    .from(agentRefreshTokens)
    .where(and(eq(agentRefreshTokens.id, existing.id), isNull(agentRefreshTokens.revokedAt)))
    .limit(1);
  const current = currentRows[0];
  if (!current?.rotatedAt) return undefined;

  const now = params.now ?? new Date();
  if (
    isWithinAgentRefreshRotationGrace({
      rotatedAt: current.rotatedAt,
      now,
      graceSeconds: params.graceSeconds,
    })
  ) {
    const successorRows = await tx
      .select()
      .from(agentRefreshTokens)
      .where(
        and(
          eq(agentRefreshTokens.grantId, current.grantId),
          isNull(agentRefreshTokens.rotatedAt),
          isNull(agentRefreshTokens.revokedAt),
          gt(agentRefreshTokens.expiresAt, now),
        ),
      )
      .limit(1);
    const successor = successorRows[0];
    if (!successor) return undefined;
    return {
      kind: 'grace',
      grant,
      predecessor: toAgentRefreshToken(current),
      successor: toAgentRefreshToken(successor),
    };
  }

  const revokedGrant = await revokeAgentGrantTx(tx, {grantId: current.grantId});
  if (!revokedGrant) return undefined;
  return {
    kind: 'reused',
    grant: revokedGrant,
    predecessor: toAgentRefreshToken(current),
  };
}

/** Rotates a refresh token atomically; a concurrent rotation cannot win twice. */
export async function rotateAgentRefreshToken(params: {
  hashedToken: string;
  replacementHashedToken: string;
  /** Defaults to the configured 14-day sliding lifetime. */
  replacementExpiresAt?: Date;
}): Promise<AgentRefreshToken | undefined> {
  return await db().transaction((tx) => rotateAgentRefreshTokenTx(tx, params));
}

export async function rotateAgentRefreshTokenTx(
  tx: AgentAccessTx,
  params: {
    hashedToken: string;
    replacementHashedToken: string;
    replacementExpiresAt?: Date;
  },
): Promise<AgentRefreshToken | undefined> {
  const replacementExpiresAt = params.replacementExpiresAt ?? agentRefreshTokenExpiresAt();
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
      expiresAt: replacementExpiresAt,
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
  deadlineMs?: number | undefined;
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
  const liveRefreshTokens = tx
    .select({id: agentRefreshTokens.id})
    .from(agentRefreshTokens)
    .where(
      and(
        eq(agentRefreshTokens.grantId, agentGrants.id),
        isNull(agentRefreshTokens.rotatedAt),
        isNull(agentRefreshTokens.revokedAt),
        gt(agentRefreshTokens.expiresAt, now),
      ),
    );
  const liveAuthorizationCodes = tx
    .select({id: agentAuthorizationCodes.id})
    .from(agentAuthorizationCodes)
    .where(
      and(
        eq(agentAuthorizationCodes.grantId, agentGrants.id),
        isNull(agentAuthorizationCodes.consumedAt),
        gt(agentAuthorizationCodes.expiresAt, now),
      ),
    );
  await prepareAgentAccessRetentionStatement(tx, params.deadlineMs);
  const candidates = await tx
    .select({id: agentGrants.id})
    .from(agentGrants)
    .where(
      and(
        isNull(agentGrants.terminalAt),
        or(
          isNotNull(agentGrants.revokedAt),
          and(notExists(liveRefreshTokens), notExists(liveAuthorizationCodes)),
        ),
      ),
    )
    .orderBy(asc(agentGrants.createdAt), asc(agentGrants.id))
    .limit(limit);

  let transitioned = 0;
  for (const candidate of candidates) {
    await prepareAgentAccessRetentionStatement(tx, params.deadlineMs);
    const grant = await lockAgentGrant(tx, {grantId: candidate.id});
    if (!grant || grant.terminalAt) continue;

    if (!grant.revokedAt) {
      await prepareAgentAccessRetentionStatement(tx, params.deadlineMs);
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

      await prepareAgentAccessRetentionStatement(tx, params.deadlineMs);
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

    await prepareAgentAccessRetentionStatement(tx, params.deadlineMs);
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
  if (row) return toAgentPersonalAccessToken(row);

  // A valid token can intentionally skip the write inside the throttle
  // window. Return its current row so callers can distinguish that from an
  // invalid, expired, or revoked token.
  const existingRows = await db()
    .select()
    .from(agentPersonalAccessTokens)
    .where(
      and(
        eq(agentPersonalAccessTokens.id, params.id),
        isNull(agentPersonalAccessTokens.revokedAt),
        gt(agentPersonalAccessTokens.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  const existing = existingRows[0];
  return existing ? toAgentPersonalAccessToken(existing) : undefined;
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
  /** Absolute epoch deadline used to bound every PostgreSQL statement. */
  deadlineMs?: number;
}

export interface PruneAgentAccessResult {
  deleted: number;
  transitioned: number;
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
  deadlineMs: number | undefined,
): Promise<number> {
  await prepareAgentAccessRetentionStatement(tx, deadlineMs);
  const candidates = await tx
    .select({id: agentAuthorizationRequests.id})
    .from(agentAuthorizationRequests)
    .where(lte(agentAuthorizationRequests.expiresAt, cutoff))
    .orderBy(asc(agentAuthorizationRequests.expiresAt), asc(agentAuthorizationRequests.id))
    .limit(limit);
  if (candidates.length === 0) return 0;

  await prepareAgentAccessRetentionStatement(tx, deadlineMs);
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
  deadlineMs: number | undefined,
): Promise<number> {
  await prepareAgentAccessRetentionStatement(tx, deadlineMs);
  const candidates = await tx
    .select({id: agentAuthorizationCodes.id})
    .from(agentAuthorizationCodes)
    .where(lte(agentAuthorizationCodes.expiresAt, cutoff))
    .orderBy(asc(agentAuthorizationCodes.expiresAt), asc(agentAuthorizationCodes.id))
    .limit(limit);
  if (candidates.length === 0) return 0;

  await prepareAgentAccessRetentionStatement(tx, deadlineMs);
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
  deadlineMs: number | undefined,
): Promise<number> {
  await prepareAgentAccessRetentionStatement(tx, deadlineMs);
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

  await prepareAgentAccessRetentionStatement(tx, deadlineMs);
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
  deadlineMs: number | undefined,
): Promise<number> {
  await prepareAgentAccessRetentionStatement(tx, deadlineMs);
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

  await prepareAgentAccessRetentionStatement(tx, deadlineMs);
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
  params: {cutoff: Date; now: Date; limit: number; deadlineMs: number | undefined},
): Promise<number> {
  const remainingCodes = tx
    .select({id: agentAuthorizationCodes.id})
    .from(agentAuthorizationCodes)
    .where(eq(agentAuthorizationCodes.grantId, agentGrants.id));
  const remainingRefreshTokens = tx
    .select({id: agentRefreshTokens.id})
    .from(agentRefreshTokens)
    .where(eq(agentRefreshTokens.grantId, agentGrants.id));
  await prepareAgentAccessRetentionStatement(tx, params.deadlineMs);
  const candidates = await tx
    .select({id: agentGrants.id, clientId: agentGrants.clientId})
    .from(agentGrants)
    .where(
      and(
        lte(agentGrants.terminalAt, params.cutoff),
        notExists(remainingCodes),
        notExists(remainingRefreshTokens),
      ),
    )
    .orderBy(asc(agentGrants.terminalAt), asc(agentGrants.id))
    .limit(params.limit)
    .for('update');
  if (candidates.length === 0) return 0;

  const grantIds = candidates.map(({id}) => id);
  // Child retention runs before this function. Do not delete a child merely
  // because its grant reached the 90-day horizon: a child can have been
  // revoked after the grant became terminal and still needs its own 30-day
  // replay/forensics window. Such a grant waits for the next sweep.
  await prepareAgentAccessRetentionStatement(tx, params.deadlineMs);
  const remainingCodeGrants = await tx
    .select({grantId: agentAuthorizationCodes.grantId})
    .from(agentAuthorizationCodes)
    .where(inArray(agentAuthorizationCodes.grantId, grantIds));
  await prepareAgentAccessRetentionStatement(tx, params.deadlineMs);
  const remainingRefreshTokenGrants = await tx
    .select({grantId: agentRefreshTokens.grantId})
    .from(agentRefreshTokens)
    .where(inArray(agentRefreshTokens.grantId, grantIds));
  const grantsWithChildren = new Set([
    ...remainingCodeGrants.map(({grantId}) => grantId),
    ...remainingRefreshTokenGrants.map(({grantId}) => grantId),
  ]);
  const deletableGrantIds = grantIds.filter((grantId) => !grantsWithChildren.has(grantId));
  if (deletableGrantIds.length === 0) return 0;

  await prepareAgentAccessRetentionStatement(tx, params.deadlineMs);
  const deletedGrants = await tx
    .delete(agentGrants)
    .where(inArray(agentGrants.id, deletableGrantIds))
    .returning({id: agentGrants.id, clientId: agentGrants.clientId});

  const clientIds = new Set(deletedGrants.map(({clientId}) => clientId));
  if (clientIds.size > 0) {
    await prepareAgentAccessRetentionStatement(tx, params.deadlineMs);
    await tx
      .update(agentClients)
      .set({
        unreferencedAt: sql`coalesce(${agentClients.unreferencedAt}, ${params.now})`,
        updatedAt: params.now,
      })
      .where(
        and(
          inArray(agentClients.id, [...clientIds]),
          notExists(
            tx
              .select({id: agentGrants.id})
              .from(agentGrants)
              .where(eq(agentGrants.clientId, agentClients.id)),
          ),
        ),
      );
  }

  return deletedGrants.length;
}

async function pruneUnreferencedAgentClients(
  tx: AgentAccessTx,
  params: {cutoff: Date; now: Date; limit: number; deadlineMs: number | undefined},
): Promise<number> {
  const liveAuthorizationRequests = tx
    .select({id: agentAuthorizationRequests.id})
    .from(agentAuthorizationRequests)
    .where(
      and(
        eq(agentAuthorizationRequests.clientId, agentClients.id),
        isNull(agentAuthorizationRequests.consumedAt),
        gt(agentAuthorizationRequests.expiresAt, params.now),
      ),
    );
  await prepareAgentAccessRetentionStatement(tx, params.deadlineMs);
  const candidates = await tx
    .select({id: agentClients.id})
    .from(agentClients)
    .where(
      and(
        or(
          lte(agentClients.unreferencedAt, params.cutoff),
          and(
            isNull(agentClients.unreferencedAt),
            lte(agentClients.createdAt, params.cutoff),
            notExists(
              tx
                .select({id: agentGrants.id})
                .from(agentGrants)
                .where(eq(agentGrants.clientId, agentClients.id)),
            ),
          ),
        ),
        notExists(liveAuthorizationRequests),
      ),
    )
    .orderBy(asc(agentClients.unreferencedAt), asc(agentClients.createdAt), asc(agentClients.id))
    .limit(params.limit)
    .for('update');

  if (candidates.length === 0) return 0;

  const candidateIds = candidates.map(({id}) => id);
  await prepareAgentAccessRetentionStatement(tx, params.deadlineMs);
  const grantsForCandidates = await tx
    .select({clientId: agentGrants.clientId})
    .from(agentGrants)
    .where(inArray(agentGrants.clientId, candidateIds));
  await prepareAgentAccessRetentionStatement(tx, params.deadlineMs);
  const liveRequestsForCandidates = await tx
    .select({clientId: agentAuthorizationRequests.clientId})
    .from(agentAuthorizationRequests)
    .where(
      and(
        inArray(agentAuthorizationRequests.clientId, candidateIds),
        isNull(agentAuthorizationRequests.consumedAt),
        gt(agentAuthorizationRequests.expiresAt, params.now),
      ),
    );
  const protectedClientIds = new Set([
    ...grantsForCandidates.map(({clientId}) => clientId),
    ...liveRequestsForCandidates.map(({clientId}) => clientId),
  ]);
  const deletableClientIds = candidateIds.filter((id) => !protectedClientIds.has(id));
  if (deletableClientIds.length === 0) return 0;

  await prepareAgentAccessRetentionStatement(tx, params.deadlineMs);
  const rows = await tx
    .delete(agentClients)
    .where(
      and(
        inArray(agentClients.id, deletableClientIds),
        or(
          lte(agentClients.unreferencedAt, params.cutoff),
          and(isNull(agentClients.unreferencedAt), lte(agentClients.createdAt, params.cutoff)),
        ),
        notExists(
          tx
            .select({id: agentGrants.id})
            .from(agentGrants)
            .where(eq(agentGrants.clientId, agentClients.id)),
        ),
        notExists(
          tx
            .select({id: agentAuthorizationRequests.id})
            .from(agentAuthorizationRequests)
            .where(
              and(
                eq(agentAuthorizationRequests.clientId, agentClients.id),
                isNull(agentAuthorizationRequests.consumedAt),
                gt(agentAuthorizationRequests.expiresAt, params.now),
              ),
            ),
        ),
      ),
    )
    .returning({id: agentClients.id});
  return rows.length;
}

/**
 * Transitions inactive grants and deletes retained agent-access rows in bounded
 * batches. The caller can override the common horizon in tests; production uses
 * the per-row windows from the agent-access retention policy.
 */
export async function pruneAgentAccess(params: PruneAgentAccessParams = {}): Promise<number> {
  return (await pruneAgentAccessBatch(params)).deleted;
}

/** Runs one bounded retention transaction and reports terminal transitions separately. */
export async function pruneAgentAccessBatch(
  params: PruneAgentAccessParams = {},
): Promise<PruneAgentAccessResult> {
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
    const transitioned = await transitionAgentGrantsToTerminalTx(tx, {
      limit,
      now,
      deadlineMs: params.deadlineMs,
    });
    const deleted =
      (await deleteExpiredAgentAuthorizationRequests(
        tx,
        cutoffs.authorization,
        limit,
        params.deadlineMs,
      )) +
      (await deleteExpiredAgentAuthorizationCodes(
        tx,
        cutoffs.authorization,
        limit,
        params.deadlineMs,
      )) +
      (await deleteRetainedAgentRefreshTokens(tx, cutoffs.refreshToken, limit, params.deadlineMs)) +
      (await deleteRetainedAgentPersonalAccessTokens(tx, cutoffs.pat, limit, params.deadlineMs)) +
      (await pruneTerminalAgentGrants(tx, {
        cutoff: cutoffs.grant,
        now,
        limit,
        deadlineMs: params.deadlineMs,
      })) +
      (await pruneUnreferencedAgentClients(tx, {
        cutoff: cutoffs.client,
        now,
        limit,
        deadlineMs: params.deadlineMs,
      }));
    return {deleted, transitioned};
  });
}
