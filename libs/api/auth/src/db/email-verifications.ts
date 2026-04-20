import {and, eq, gt, isNull, sql} from 'drizzle-orm';
import type {EmailVerification} from '#core/entities/email-verification.js';
import {db} from './db.js';
import {emailVerifications, toEmailVerification} from './schema/email-verifications.js';

export interface CreateEmailVerificationParams {
  userId: string;
  hashedToken: string;
  expiresAt: Date;
}

export async function createEmailVerification(
  params: CreateEmailVerificationParams,
): Promise<EmailVerification> {
  return await db().transaction(async (tx) => {
    await tx
      .update(emailVerifications)
      .set({usedAt: sql`now()`})
      .where(and(eq(emailVerifications.userId, params.userId), isNull(emailVerifications.usedAt)));

    const rows = await tx
      .insert(emailVerifications)
      .values({
        userId: params.userId,
        hashedToken: params.hashedToken,
        expiresAt: params.expiresAt,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error('Insert returned no rows');
    return toEmailVerification(row);
  });
}

export async function consumeEmailVerification(params: {
  hashedToken: string;
}): Promise<EmailVerification | undefined> {
  const rows = await db()
    .update(emailVerifications)
    .set({usedAt: sql`now()`})
    .where(
      and(
        eq(emailVerifications.hashedToken, params.hashedToken),
        isNull(emailVerifications.usedAt),
        gt(emailVerifications.expiresAt, sql`now()`),
      ),
    )
    .returning();

  const row = rows[0];
  if (!row) return undefined;
  return toEmailVerification(row);
}
