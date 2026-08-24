import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {eq} from 'drizzle-orm';
import {config} from '#config.js';
import type {AgentSession} from '#core/entities/agent-session.js';
import {db} from '#db/db.js';
import {
  getSessionById,
  hasSessionReferencingObjectKey,
  listExpiredSessions,
  listSegmentPruneCandidates,
} from '#db/retention.js';
import {sessions} from '#db/schema/sessions.js';
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
 *   losing CAS) are collected only for sessions that are unclaimed and whose
 *   last mutation is older than the grace. An in-flight commit always holds the
 *   claim, which makes the per-session fresh-read guard race-free.
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

  const skip = new Set<string>();
  // Runs one bounded batch pass; returns whether a further pass may find more work.
  const runPass = async (
    list: (excludeIds: string[] | undefined) => Promise<AgentSession[]>,
    process: (session: AgentSession) => Promise<void>,
  ): Promise<boolean> => {
    if (now() >= deadline) {
      result.timedOut = true;
      return false;
    }

    const batch = await list(skip.size > 0 ? [...skip] : undefined);
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
        skip.add(session.id);
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
  while (result.iterations < params.maxIterations) {
    const more = await runPass(
      (excludeIds) =>
        listExpiredSessions({
          retentionDays: params.retentionDays,
          limit: params.batchLimit,
          excludeIds,
        }),
      async (session) => {
        await deleteExpiredSession(session);
        result.sessionsDeleted += 1;
      },
    );
    if (!more) break;
  }

  // Phases 2+3: superseded segments (grace-elapsed) and orphans (unclaimed, grace-elapsed).
  while (result.iterations < params.maxIterations) {
    const more = await runPass(
      (excludeIds) =>
        listSegmentPruneCandidates({
          graceSeconds: params.segmentGraceSeconds,
          limit: params.batchLimit,
          excludeIds,
        }),
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
 */
async function deleteExpiredSession(session: AgentSession): Promise<void> {
  await db().transaction(async (tx) => {
    const [row] = await tx
      .select({id: sessions.id, headObjectKey: sessions.headObjectKey})
      .from(sessions)
      .where(eq(sessions.id, session.id))
      .for('update');
    if (!row) return;

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
 * its orphans. The fresh read is the race anchor: any commit in flight implies
 * a claim granted before its upload, so a session that is claimed at read time
 * keeps its orphans, and a claim granted after the read cannot flip before this
 * function's deletes complete (the flip re-uploads the segment it commits).
 */
async function pruneSessionSegments(
  session: AgentSession,
  now: number,
  graceMs: number,
): Promise<{superseded: number; orphans: number}> {
  const fresh = await getSessionById(session.id);
  if (!fresh) return {superseded: 0, orphans: 0};
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
    const parsed = parseSessionObjectKey(key);
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
}
