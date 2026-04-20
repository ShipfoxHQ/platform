import {and, eq, gt, isNull, sql} from 'drizzle-orm';
import type {PasswordReset} from '#core/entities/password-reset.js';
import {db} from './db.js';
import {passwordResets, toPasswordReset} from './schema/password-resets.js';

export interface CreatePasswordResetParams {
  userId: string;
  hashedToken: string;
  expiresAt: Date;
}

export async function createPasswordReset(
  params: CreatePasswordResetParams,
): Promise<PasswordReset> {
  return await db().transaction(async (tx) => {
    await tx
      .update(passwordResets)
      .set({usedAt: sql`now()`})
      .where(and(eq(passwordResets.userId, params.userId), isNull(passwordResets.usedAt)));

    const rows = await tx
      .insert(passwordResets)
      .values({
        userId: params.userId,
        hashedToken: params.hashedToken,
        expiresAt: params.expiresAt,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error('Insert returned no rows');
    return toPasswordReset(row);
  });
}

export async function consumePasswordReset(params: {
  hashedToken: string;
}): Promise<PasswordReset | undefined> {
  const rows = await db()
    .update(passwordResets)
    .set({usedAt: sql`now()`})
    .where(
      and(
        eq(passwordResets.hashedToken, params.hashedToken),
        isNull(passwordResets.usedAt),
        gt(passwordResets.expiresAt, sql`now()`),
      ),
    )
    .returning();

  const row = rows[0];
  if (!row) return undefined;
  return toPasswordReset(row);
}
