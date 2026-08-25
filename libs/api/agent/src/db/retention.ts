import {and, asc, eq, getTableColumns, isNotNull, isNull, lt, sql} from 'drizzle-orm';
import type {AgentSession} from '#core/entities/agent-session.js';
import {type Database, db, type Transaction} from './db.js';
import {sessions, toAgentSession} from './schema/sessions.js';

export interface ExpiredSessionsCursor {
  /** PostgreSQL timestamp text, preserving precision beyond JavaScript milliseconds. */
  retiredAt: string;
  id: string;
}

export interface PruneCandidatesCursor {
  /** PostgreSQL timestamp text, preserving precision beyond JavaScript milliseconds. */
  updatedAt: string;
  id: string;
}

export interface ExpiredSessionCandidate {
  session: AgentSession;
  cursor: ExpiredSessionsCursor;
}

export interface PruneSessionCandidate {
  session: AgentSession;
  cursor: PruneCandidatesCursor;
}

/**
 * Lists sessions whose run attempt reached a terminal state more than
 * `retentionDays` ago, in `(retired_at, id)` order. `after` continues from the
 * previous pass's last row (cursor paging) instead of accumulating processed
 * IDs in an ever-growing `NOT IN` list, so a large backlog never makes the
 * query heavier or trips the driver's bind-parameter limit. The cursor keeps
 * the exact PostgreSQL timestamp text plus the id tiebreak. A JavaScript
 * `Date` would truncate PostgreSQL microseconds and could reselect the cursor
 * row forever.
 */
export async function listExpiredSessions(params: {
  retentionDays: number;
  limit: number;
  after?: ExpiredSessionsCursor | undefined;
}): Promise<ExpiredSessionCandidate[]> {
  const rows = await db()
    .select({
      ...getTableColumns(sessions),
      cursorRetiredAt: sql<string>`${sessions.retiredAt}::text`,
    })
    .from(sessions)
    .where(
      and(
        isNotNull(sessions.retiredAt),
        lt(sessions.retiredAt, sql`now() - make_interval(days => ${params.retentionDays})`),
        params.after
          ? sql`(${sessions.retiredAt}, ${sessions.id}) > (${params.after.retiredAt}::timestamptz, ${params.after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(asc(sessions.retiredAt), asc(sessions.id))
    .limit(params.limit)
    .for('update', {skipLocked: true});

  return rows.map((row) => ({
    session: toAgentSession(row),
    cursor: {retiredAt: row.cursorRetiredAt, id: row.id},
  }));
}

/**
 * Lists sessions whose last mutation (head flip, claim, or release) is older
 * than the segment grace, so their superseded segments and orphans may be
 * pruned, in `(updated_at, id)` order. `after` is the cursor for the next pass
 * (see `listExpiredSessions`). Orphan candidates are only collected while the
 * session is unclaimed; the sweep re-verifies the claim under a `FOR UPDATE`
 * lock held through the object deletion (see `pruneSessionSegments`), because
 * a claim granted after this list read could land an upload the sweep would
 * otherwise delete.
 */
export async function listSegmentPruneCandidates(params: {
  graceSeconds: number;
  limit: number;
  after?: PruneCandidatesCursor | undefined;
}): Promise<PruneSessionCandidate[]> {
  const rows = await db()
    .select({
      ...getTableColumns(sessions),
      cursorUpdatedAt: sql<string>`${sessions.updatedAt}::text`,
    })
    .from(sessions)
    .where(
      and(
        lt(sessions.updatedAt, sql`now() - make_interval(secs => ${params.graceSeconds})`),
        sql`(${sessions.headSegment} >= 2 or ${sessions.claimedByStepAttempt} is null)`,
        params.after
          ? sql`(${sessions.updatedAt}, ${sessions.id}) > (${params.after.updatedAt}::timestamptz, ${params.after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(asc(sessions.updatedAt), asc(sessions.id))
    .limit(params.limit)
    .for('update', {skipLocked: true});

  return rows.map((row) => ({
    session: toAgentSession(row),
    cursor: {updatedAt: row.cursorUpdatedAt, id: row.id},
  }));
}

/** Fresh read used as the sweep's per-session guard before any object is deleted. */
export async function getSessionById(sessionId: string): Promise<AgentSession | null> {
  const [row] = await db().select().from(sessions).where(eq(sessions.id, sessionId));
  return row ? toAgentSession(row) : null;
}

/**
 * Whether another session row references the object key as its head. Rerun
 * carry-over copies the source head pointer, so an expired source session must
 * keep its head object until every carried-over target is gone too. Accepts
 * the plain database as well as a transaction so both the retention sweep
 * (inside its row-locked transaction) and the store-level deletion path use
 * the same ownership check.
 */
export async function hasSessionReferencingObjectKey(
  executor: Transaction | Database,
  sessionId: string,
  objectKey: string,
): Promise<boolean> {
  const [row] = await executor
    .select({id: sessions.id})
    .from(sessions)
    .where(and(eq(sessions.headObjectKey, objectKey), sql`${sessions.id} <> ${sessionId}`))
    .limit(1);
  return row !== undefined;
}

/**
 * Stamps every session of a run attempt with `retired_at` when the attempt
 * reaches a terminal state. Idempotent: a redelivered run-terminated event
 * keeps the original stamp, and replayed outbox deliveries update nothing.
 */
export async function retireSessionsForRunAttempt(
  tx: Transaction,
  workflowRunAttemptId: string,
): Promise<number> {
  const rows = await tx
    .update(sessions)
    .set({
      retiredAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(sessions.workflowRunAttemptId, workflowRunAttemptId), isNull(sessions.retiredAt)))
    .returning({id: sessions.id});
  return rows.length;
}
