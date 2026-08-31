import {and, eq, gt, isNull, sql} from 'drizzle-orm';
import type {
  AgentAuthorizationCode,
  AgentAuthorizationRequest,
  AgentClient,
  AgentGrant,
} from '#core/entities/agent-access.js';
import {db} from './db.js';
import {
  agentAuthorizationCodes,
  agentAuthorizationRequests,
  agentClients,
  agentGrants,
  toAgentAuthorizationCode,
  toAgentAuthorizationRequest,
  toAgentClient,
  toAgentGrant,
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
  const rows = await tx.insert(agentClients).values(params).returning();
  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
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
  params: {clientId: string},
): Promise<void> {
  await tx
    .update(agentClients)
    .set({unreferencedAt: null, updatedAt: sql`now()`})
    .where(eq(agentClients.id, params.clientId));
}

export interface CreateAgentAuthorizationRequestParams {
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
  codeChallenge: string;
  state: string;
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
  const rows = await tx.insert(agentGrants).values(params).returning();
  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');

  await markAgentClientReferenced(tx, {clientId: params.clientId});
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
 * changing grant state.
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
