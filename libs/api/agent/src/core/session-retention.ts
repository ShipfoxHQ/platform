import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {eq, sql} from 'drizzle-orm';
import {config} from '#config.js';
import type {AgentSession} from '#core/entities/agent-session.js';
import {db} from '#db/db.js';
import {
  type ExpiredSessionsCursor,
  hasSessionReferencingObjectKey,
  listExpiredSessions,
  listSegmentPruneCandidates,
  type PruneCandidatesCursor,
} from '#db/retention.js';
import {sessions, toAgentSession} from '#db/schema/sessions.js';
import {parseSessionObjectKey, sessionObjectKeyPrefix} from './session-artifacts/object-key.js';
import {deleteSessionObjects, listSessionObjectKeys} from './session-artifacts/object-storage.js';

export interface SessionRetentionSweepResult {
  /** Sessions whose objects and row were deleted (run terminal + retention window elapsed). */
  sessionsDeleted: number;
  /** Superseded segments pruned after the grace period. */
  supersededPruned: number;
  /** Orphaned segments (written but never flipped into a head) collected. */
  orphansPruned: number;
  /** Sessions whose cleanup threw; logged, skipped, and retried next run. */
  failed: number;
  iterations: number;
  /** True when the sweep stopped on its wall-clock budget with backlog likely remaining. */
  timedOut: boolean;
}

export interface RunSessionRetentionSweepParams {
  retentionDays: number;
  /** Grace before superseded segments are pruned and orphans of unclaimed sessions are collected. */
  segmentGraceSeconds: number;
  batchLimit: number;
  timeBudgetMs: number;
  maxIterations: number;
  /** Wall clock; injectable so tests can drive the time budget deterministically. */
  now?: () => number;
  /** Liveness signal (e.g. the activity heartbeat); invoked once per processed session. */
  onProgress?: () => void;
}

/**
 * Deletes expired sessions and prunes superseded and orphaned transcript
 * segments, mirroring the logs retention model:
 *
 * * Rows: sessions are retired by the run-terminated subscriber; once retirement
 *   is older than the retention window, objects are deleted before the row (a
 *   cleanup failure leaves the row discoverable for the next sweep). Head
 *   objects still referenced by a carried-over rerun row are kept, under a
 *   `FOR UPDATE` row lock so a concurrent carry-over can never copy a pointer
 *   to an object the sweep already deleted.
 * * Superseded segments (segment < head) are pruned after a short grace rather
 *   than inline, so a concurrent fork snapshot read that resolved the old head
 *   can still stream its object. `updated_at` is the conservative proxy for the
 *   last head flip: it is bumped by every mutation, so pruning only when it is
 *   older than the grace can never delete a segment younger than the grace.
 * * Orphans (segment > head, from a crash between write and head flip, or a
 *   losing CAS) are collected only for sessions that are unclaimed at a fresh
 *   `FOR UPDATE` read held through the deletion: a claim granted after that
 *   read cannot land an upload the sweep would then delete, because the claim
 *   itself needs the row lock the sweep already holds. A session whose last
 *   mutation is younger than the grace is skipped entirely.
 */
export async function runSessionRetentionSweep(
  params: RunSessionRetentionSweepParams,
): Promise<SessionRetentionSweepResult> {
  const now = params.now ?? Date.now;
  const deadline = now() + params.timeBudgetMs;
  const result: SessionRetentionSweepResult = {
    sessionsDeleted: 0,
    supersededPruned: 0,
    orphansPruned: 0,
    failed: 0,
    iterations: 0,
    timedOut: false,
  };
  const graceMs = params.segmentGraceSeconds * 1000;

  // Runs one bounded batch pass; returns whether a further pass may find more work.
  const runPass = async (
    list: () => Promise<AgentSession[]>,
    process: (session: AgentSession) => Promise<void>,
  ): Promise<boolean> => {
    if (now() >= deadline) {
      result.timedOut = true;
      return false;
    }

    const batch = await list();
    if (batch.length === 0) return false;

    for (const session of batch) {
      params.onProgress?.();
      if (now() >= deadline) {
        result.timedOut = true;
        return false;
      }

      try {
        await process(session);
      } catch (error) {
        result.failed += 1;
        logger().error(
          {err: error, sessionId: session.id},
          'Failed to process agent session during retention sweep',
        );
        reportError(error, {boundary: 'agent.retention', extra: {sessionId: session.id}});
      }
    }

    result.iterations += 1;
    return batch.length >= params.batchLimit;
  };

  // Phase 1: expired sessions — objects before row, guarded on carried-over references.
  // Cursor paging on `(retired_at, id)`: every pass advances past the previous
  // batch, so a large backlog never re-selects the same rows and processed IDs
  // are not accumulated in an ever-growing `NOT IN` list.
  let expiredCursor: ExpiredSessionsCursor | undefined;
  while (result.iterations < params.maxIterations) {
    const more = await runPass(
      async () => {
        const batch = await listExpiredSessions({
          retentionDays: params.retentionDays,
          limit: params.batchLimit,
          after: expiredCursor,
        });
        const last = batch[batch.length - 1];
        if (last) {
          if (last.retiredAt === null) {
            // listExpiredSessions filters `retired_at is not null`, so this
            // only guards the cursor type, never a real row.
            throw new Error(`Expired session row missing retired_at: ${last.id}`);
          }
          expiredCursor = {retiredAt: last.retiredAt, id: last.id};
        }
        return batch;
      },
      async (session) => {
        await deleteExpiredSession(session);
        result.sessionsDeleted += 1;
      },
    );
    if (!more) break;
  }

  // Phases 2+3: superseded segments (grace-elapsed) and orphans (unclaimed, grace-elapsed).
  // Same cursor paging on `(updated_at, id)`: pruning never touches the row, so
  // without advancing the cursor the candidate query would re-select the same
  // oldest-by-`updated_at` batch on every pass and a large backlog would never
  // advance.
  let pruneCursor: PruneCandidatesCursor | undefined;
  while (result.iterations < params.maxIterations) {
    const more = await runPass(
      async () => {
        const batch = await listSegmentPruneCandidates({
          graceSeconds: params.segmentGraceSeconds,
          limit: params.batchLimit,
          after: pruneCursor,
        });
        const last = batch[batch.length - 1];
        if (last) pruneCursor = {updatedAt: last.updatedAt, id: last.id};
        return batch;
      },
      async (session) => {
        const outcome = await pruneSessionSegments(session, now(), graceMs);
        result.supersededPruned += outcome.superseded;
        result.orphansPruned += outcome.orphans;
      },
    );
    if (!more) break;
  }

  return result;
}

/**
 * Deletes one expired session: its objects (minus head objects a carried-over
 * rerun row still references) and then its row. The object deletion and the
 * row delete happen under a `FOR UPDATE` lock on the session row, so a
 * concurrent `carryOverSessions` (which locks the same source rows) can never
 * copy a head pointer to an object deleted by this sweep.
 *
 * When the head object is shared with carried-over rows, a transaction-scoped
 * advisory lock keyed on the object key serializes the ownership decision
 * between concurrent sweep executions: whichever row is deleted last sees the
 * other rows gone and deletes the object, so two sweeps processing the same
 * shared head can never both preserve it and leave a permanent storage orphan.
 */
async function deleteExpiredSession(session: AgentSession): Promise<void> {
  await db().transaction(async (tx) => {
    const [row] = await tx
      .select({id: sessions.id, headObjectKey: sessions.headObjectKey})
      .from(sessions)
      .where(eq(sessions.id, session.id))
      .for('update');
    if (!row) return;

    // Serialize the shared-head ownership check across concurrent sweeps (by
    // object key, per the retention model): the lock is held until this
    // transaction commits, so a concurrent sweep processing a row that shares
    // this head object waits here and then sees this row already deleted.
    if (row.headObjectKey !== null) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${row.headObjectKey}, 0))`,
      );
    }

    const prefix = sessionObjectKeyPrefix(config.AGENT_SESSION_STORAGE_S3_PREFIX, {
      workspaceId: session.workspaceId,
      workflowRunAttemptId: session.workflowRunAttemptId,
      sessionId: session.id,
    });
    const keys = await listSessionObjectKeys(prefix);

    const deletable = [...keys];
    if (row.headObjectKey !== null) {
      if (await hasSessionReferencingObjectKey(tx, session.id, row.headObjectKey)) {
        const index = deletable.indexOf(row.headObjectKey);
        if (index >= 0) deletable.splice(index, 1);
      } else if (!keys.includes(row.headObjectKey)) {
        // Carried-over rows point at the source run attempt's prefix; the exact
        // head key must be removed here because the source prefix is not ours.
        deletable.push(row.headObjectKey);
      }
    }

    if (deletable.length > 0) await deleteSessionObjects(deletable);

    const rows = await tx
      .delete(sessions)
      .where(eq(sessions.id, session.id))
      .returning({id: sessions.id});
    if (rows.length === 0) throw new Error(`Session row disappeared mid-retention: ${session.id}`);
  });
}

/**
 * Prunes a session's superseded segments and, when the session is unclaimed,
 * its orphans. The whole pass runs under a `FOR UPDATE` lock on the session
 * row, held until the object deletes commit, and the classification uses that
 * locked fresh read: a claim granted concurrently (by a rerun about to commit
 * segment `head + 1`) needs the same row lock, so it either commits before the
 * read — making the session claimed and its segments safe — or fails fast on
 * the `SKIP LOCKED` claim while the sweep holds the lock. A stale unlocked
 * read could classify an in-flight commit's freshly uploaded segment as an
 * orphan and delete the object the commit then flips to.
 */
function pruneSessionSegments(
  session: AgentSession,
  now: number,
  graceMs: number,
): Promise<{superseded: number; orphans: number}> {
  return db().transaction(async (tx) => {
    const [freshRow] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id))
      .for('update');
    if (!freshRow) return {superseded: 0, orphans: 0};
    const fresh = toAgentSession(freshRow);
    if (fresh.updatedAt.getTime() >= now - graceMs) return {superseded: 0, orphans: 0};

    const prefix = sessionObjectKeyPrefix(config.AGENT_SESSION_STORAGE_S3_PREFIX, {
      workspaceId: fresh.workspaceId,
      workflowRunAttemptId: fresh.workflowRunAttemptId,
      sessionId: fresh.id,
    });
    const keys = await listSessionObjectKeys(prefix);

    const superseded: string[] = [];
    const orphans: string[] = [];
    for (const key of keys) {
      const parsed = parseSessionObjectKey(key, config.AGENT_SESSION_STORAGE_S3_PREFIX);
      if (!parsed) continue;
      if (parsed.segment === fresh.headSegment) continue;
      if (parsed.segment < fresh.headSegment) {
        superseded.push(key);
      } else if (fresh.claimedByStepAttempt === null) {
        orphans.push(key);
      }
    }

    if (superseded.length > 0) await deleteSessionObjects(superseded);
    if (orphans.length > 0) await deleteSessionObjects(orphans);
    return {superseded: superseded.length, orphans: orphans.length};
  });
}
