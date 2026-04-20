import {and, eq, gt, isNull, ne, sql} from 'drizzle-orm';
import type {RefreshToken} from '#core/entities/refresh-token.js';
import {db} from './db.js';
import {refreshTokens, toRefreshToken} from './schema/refresh-tokens.js';

export interface CreateRefreshTokenParams {
  userId: string;
  hashedToken: string;
  expiresAt: Date;
}

export async function createRefreshToken(params: CreateRefreshTokenParams): Promise<RefreshToken> {
  const rows = await db()
    .insert(refreshTokens)
    .values({
      userId: params.userId,
      hashedToken: params.hashedToken,
      expiresAt: params.expiresAt,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toRefreshToken(row);
}

export async function findActiveRefreshTokenByHash(params: {
  hashedToken: string;
}): Promise<RefreshToken | undefined> {
  const rows = await db()
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.hashedToken, params.hashedToken),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, sql`now()`),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toRefreshToken(row);
}

export async function rotateActiveRefreshToken(params: {
  id: string;
  currentHashedToken: string;
  nextHashedToken: string;
  expiresAt: Date;
}): Promise<RefreshToken | undefined> {
  const rows = await db()
    .update(refreshTokens)
    .set({
      hashedToken: params.nextHashedToken,
      expiresAt: params.expiresAt,
      lastUsedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(refreshTokens.id, params.id),
        eq(refreshTokens.hashedToken, params.currentHashedToken),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, sql`now()`),
      ),
    )
    .returning();

  const row = rows[0];
  if (!row) return undefined;
  return toRefreshToken(row);
}

export async function revokeRefreshTokenByHash(params: {hashedToken: string}): Promise<void> {
  await db()
    .update(refreshTokens)
    .set({revokedAt: sql`now()`, updatedAt: sql`now()`})
    .where(and(eq(refreshTokens.hashedToken, params.hashedToken), isNull(refreshTokens.revokedAt)));
}

export async function revokeRefreshTokensForUser(params: {
  userId: string;
  exceptRefreshTokenId?: string | undefined;
}): Promise<void> {
  await db()
    .update(refreshTokens)
    .set({revokedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(refreshTokens.userId, params.userId),
        isNull(refreshTokens.revokedAt),
        params.exceptRefreshTokenId ? ne(refreshTokens.id, params.exceptRefreshTokenId) : undefined,
      ),
    );
}
