import {and, eq} from 'drizzle-orm';
import type {RunnerToken} from '#core/entities/runner-token.js';
import {db} from './db.js';
import {runnerTokens, toRunnerToken} from './schema/runner-tokens.js';

export interface CreateRunnerTokenParams {
  workspaceId: string;
  hashedToken: string;
  prefix: string;
  name?: string | undefined;
  expiresAt?: Date | undefined;
}

export async function createRunnerToken(params: CreateRunnerTokenParams): Promise<RunnerToken> {
  const rows = await db()
    .insert(runnerTokens)
    .values({
      workspaceId: params.workspaceId,
      hashedToken: params.hashedToken,
      prefix: params.prefix,
      name: params.name ?? null,
      expiresAt: params.expiresAt ?? null,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toRunnerToken(row);
}

export async function resolveRunnerTokenByHash(
  hashedToken: string,
): Promise<RunnerToken | undefined> {
  const rows = await db()
    .select()
    .from(runnerTokens)
    .where(eq(runnerTokens.hashedToken, hashedToken))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toRunnerToken(row);
}

export async function revokeRunnerToken(params: {
  tokenId: string;
  workspaceId: string;
}): Promise<RunnerToken | undefined> {
  const rows = await db()
    .update(runnerTokens)
    .set({revokedAt: new Date(), updatedAt: new Date()})
    .where(
      and(eq(runnerTokens.id, params.tokenId), eq(runnerTokens.workspaceId, params.workspaceId)),
    )
    .returning();

  const row = rows[0];
  if (!row) return undefined;
  return toRunnerToken(row);
}
