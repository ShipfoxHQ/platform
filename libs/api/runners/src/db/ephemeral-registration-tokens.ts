import {asc, inArray, lt, sql} from 'drizzle-orm';
import {db} from './db.js';
import {ephemeralRegistrationTokens} from './schema/ephemeral-registration-tokens.js';

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
