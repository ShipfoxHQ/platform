import {and, asc, eq, getTableColumns, isNull, lt, notInArray, sql} from 'drizzle-orm';
import type {AttemptStream, StreamCloseReason} from '#core/entities/attempt-stream.js';
import {LeaseStreamMismatchError} from '#core/errors.js';
import {db, type Transaction} from './db.js';
import {attemptStreams, toAttemptStream} from './schema/attempt-streams.js';
import {logChunks} from './schema/chunks.js';

export interface AttemptStreamIdentity {
  jobId: string;
  stepId: string;
  attempt: number;
  workspaceId: string;
  projectId: string;
  workflowRunAttemptId: string;
}

export interface AttemptStreamLookup {
  jobId: string;
  stepId: string;
  attempt: number;
}

/**
 * Reads the stream for `(job, step, attempt)` without creating it. Used by the
 * empty-body heartbeat path so a runner cannot mint rows with empty appends.
 */
export async function getAttemptStream(
  tx: Transaction,
  lookup: AttemptStreamLookup,
): Promise<AttemptStream | null> {
  const [row] = await tx
    .select()
    .from(attemptStreams)
    .where(
      and(
        eq(attemptStreams.jobId, lookup.jobId),
        eq(attemptStreams.stepId, lookup.stepId),
        eq(attemptStreams.attempt, lookup.attempt),
      ),
    );
  return row ? toAttemptStream(row) : null;
}

/**
 * Reads the stream for `(step, attempt)` for the session read path, which holds no lease
 * and so has no `jobId`. `stepId` is a globally unique uuidv7, so `(stepId, attempt)`
 * selects at most one row even though stream identity is `(jobId, stepId, attempt)`. The
 * caller authorizes against the row's denormalized `workspaceId`.
 */
export async function getStreamByStepAttempt(lookup: {
  stepId: string;
  attempt: number;
}): Promise<AttemptStream | null> {
  const [row] = await db()
    .select()
    .from(attemptStreams)
    .where(
      and(eq(attemptStreams.stepId, lookup.stepId), eq(attemptStreams.attempt, lookup.attempt)),
    );
  return row ? toAttemptStream(row) : null;
}

export interface GetOrCreateAttemptStreamResult {
  stream: AttemptStream;
  created: boolean;
}

/**
 * Loads the stream for `(job, step, attempt)`, creating it on first append.
 * Scoped by `jobId` from the lease, so a lease never reaches another job's stream.
 * The create path reports whether the row was inserted so callers can record
 * first-open side effects only after their enclosing transaction commits.
 */
export async function getOrCreateAttemptStreamWithStatus(
  tx: Transaction,
  identity: AttemptStreamIdentity,
): Promise<GetOrCreateAttemptStreamResult> {
  const [row] = await tx
    .insert(attemptStreams)
    .values(identity)
    .onConflictDoUpdate({
      target: [attemptStreams.jobId, attemptStreams.stepId, attemptStreams.attempt],
      set: {updatedAt: sql`now()`},
    })
    // Postgres sets `xmax` only on the conflict-update path, so this keeps
    // first-open detection in the single upsert round trip.
    .returning({...getTableColumns(attemptStreams), created: sql<boolean>`xmax = 0`});

  if (!row) throw new Error('attempt stream missing after get-or-create');
  if (
    row.workspaceId !== identity.workspaceId ||
    row.projectId !== identity.projectId ||
    row.workflowRunAttemptId !== identity.workflowRunAttemptId
  ) {
    throw new LeaseStreamMismatchError();
  }
  return {stream: toAttemptStream(row), created: row.created};
}

export async function getOrCreateAttemptStream(
  tx: Transaction,
  identity: AttemptStreamIdentity,
): Promise<AttemptStream> {
  const result = await getOrCreateAttemptStreamWithStatus(tx, identity);
  return result.stream;
}

export type CasOutcome = 'extended' | 'retry' | 'gap';

export interface CasResult {
  outcome: CasOutcome;
  committedLength: number;
}

/**
 * Offset-CAS extend: advances `committed_length` by `byteLen` iff it currently
 * equals `offset`. On mismatch, re-reads the committed length and classifies the
 * caller's chunk: a retry (fully already applied) only when `offset + byteLen`
 * does not run past the committed length; otherwise a gap. A chunk that straddles
 * the committed point (offset behind it, but extending past it) is a gap too, so
 * the runner rewinds rather than getting a 200 that silently drops its tail.
 */
export async function casExtendCommittedLength(
  tx: Transaction,
  params: {streamId: string; offset: number; byteLen: number},
): Promise<CasResult> {
  const extended = await tx
    .update(attemptStreams)
    .set({
      committedLength: sql`${attemptStreams.committedLength} + ${params.byteLen}`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(attemptStreams.id, params.streamId),
        eq(attemptStreams.committedLength, params.offset),
      ),
    )
    .returning({committedLength: attemptStreams.committedLength});

  if (extended[0]) return {outcome: 'extended', committedLength: extended[0].committedLength};

  const [current] = await tx
    .select({committedLength: attemptStreams.committedLength})
    .from(attemptStreams)
    .where(eq(attemptStreams.id, params.streamId));
  const committedLength = current?.committedLength ?? 0;

  const fullyApplied = params.offset + params.byteLen <= committedLength;
  return {outcome: fullyApplied ? 'retry' : 'gap', committedLength};
}

export async function setDeclaredTotalBytes(
  tx: Transaction,
  params: {streamId: string; declaredTotalBytes: number},
): Promise<void> {
  await tx
    .update(attemptStreams)
    .set({declaredTotalBytes: params.declaredTotalBytes, updatedAt: sql`now()`})
    .where(eq(attemptStreams.id, params.streamId));
}

export async function setClaudeParseContext(
  tx: Transaction,
  params: {
    streamId: string;
    hasInit: boolean;
    sessionId: string | null;
    turn: number;
  },
): Promise<void> {
  await tx
    .update(attemptStreams)
    .set({
      claudeHasInit: params.hasInit,
      claudeSessionId: params.sessionId,
      claudeTurn: params.turn,
      updatedAt: sql`now()`,
    })
    .where(eq(attemptStreams.id, params.streamId));
}

/**
 * Guarded close: flips `open → closed` and stamps `closed_at` iff the stream is
 * still open, returning the closed row (or null when another path already closed
 * it). The `WHERE state='open'` predicate is both the row lock and the
 * exactly-once gate. `committed_length` is left untouched; it stays equal to the
 * runner spool bytes. `truncated` is set only on the timeout path.
 */
export async function markStreamClosed(
  tx: Transaction,
  params: {streamId: string; reason: StreamCloseReason; markTruncated: boolean},
): Promise<AttemptStream | null> {
  const [row] = await tx
    .update(attemptStreams)
    .set({
      state: 'closed',
      closeReason: params.reason,
      closedAt: sql`now()`,
      updatedAt: sql`now()`,
      ...(params.markTruncated ? {truncated: true} : {}),
    })
    .where(and(eq(attemptStreams.id, params.streamId), eq(attemptStreams.state, 'open')))
    .returning();

  return row ? toAttemptStream(row) : null;
}

/** Open streams of a job, for the timeout sweep to force-close after the grace period. */
export async function listOpenStreamsByJob(jobId: string): Promise<AttemptStream[]> {
  const rows = await db()
    .select()
    .from(attemptStreams)
    .where(and(eq(attemptStreams.jobId, jobId), eq(attemptStreams.state, 'open')));

  return rows.map(toAttemptStream);
}

/** For compaction, which is driven by the closed event that carries the stream id. */
export async function getAttemptStreamById(streamId: string): Promise<AttemptStream | null> {
  const [row] = await db().select().from(attemptStreams).where(eq(attemptStreams.id, streamId));
  return row ? toAttemptStream(row) : null;
}

export async function getAttemptStreamByIdInTransaction(
  tx: Transaction,
  streamId: string,
): Promise<AttemptStream | null> {
  const [row] = await tx.select().from(attemptStreams).where(eq(attemptStreams.id, streamId));
  return row ? toAttemptStream(row) : null;
}

/**
 * Final compaction step: records the object key and deletes the now-cold chunk rows in one
 * transaction. The guard is `state='closed' AND object_key IS NULL`, so the publish is a
 * single winner even when two compaction attempts (e.g. a heartbeat-timed-out run and its
 * retry) race: each uploads to its own key, and only the first to land here writes a key and
 * drops the chunks. A 0-row result means the row was either hard-deleted by retention or
 * already published by another attempt; the caller re-reads to tell those apart and deletes
 * its own now-orphaned upload either way. Returns whether this attempt won the publish.
 */
export async function setObjectKeyAndDeleteChunks(
  tx: Transaction,
  params: {streamId: string; objectKey: string},
): Promise<{updated: boolean}> {
  const updated = await tx
    .update(attemptStreams)
    .set({objectKey: params.objectKey, updatedAt: sql`now()`})
    .where(
      and(
        eq(attemptStreams.id, params.streamId),
        eq(attemptStreams.state, 'closed'),
        isNull(attemptStreams.objectKey),
      ),
    )
    .returning({id: attemptStreams.id});

  if (updated.length === 0) return {updated: false};

  await tx.delete(logChunks).where(eq(logChunks.streamId, params.streamId));
  return {updated: true};
}

/**
 * Closed streams that never got an object key and have sat that way past the stale
 * window: the reconcile cron re-drives compaction for these. Hits the partial index
 * `logs_attempt_streams_uncompacted_idx`; ordered by `closed_at` so the oldest backlog
 * drains first, bounded by `limit` per tick.
 */
export async function listStaleUncompactedStreams(params: {
  olderThanSeconds: number;
  limit: number;
}): Promise<AttemptStream[]> {
  const rows = await db()
    .select()
    .from(attemptStreams)
    .where(
      and(
        eq(attemptStreams.state, 'closed'),
        isNull(attemptStreams.objectKey),
        lt(attemptStreams.closedAt, sql`now() - make_interval(secs => ${params.olderThanSeconds})`),
      ),
    )
    .orderBy(asc(attemptStreams.closedAt))
    .limit(params.limit);

  return rows.map(toAttemptStream);
}

/**
 * Lists open streams old enough to force-close. The age check is safe only when
 * `olderThanSeconds` exceeds the lease TTL: leases are minted before a stream can
 * be created, so no valid append can arrive after `created_at + leaseTTL`.
 */
export async function listStaleOpenStreams(params: {
  olderThanSeconds: number;
  limit: number;
}): Promise<AttemptStream[]> {
  const rows = await db()
    .select()
    .from(attemptStreams)
    .where(
      and(
        eq(attemptStreams.state, 'open'),
        lt(
          attemptStreams.createdAt,
          sql`now() - make_interval(secs => ${params.olderThanSeconds})`,
        ),
      ),
    )
    .orderBy(asc(attemptStreams.createdAt))
    .limit(params.limit);

  return rows.map(toAttemptStream);
}

export async function getOpenStreamCount(): Promise<bigint> {
  const [row] = await db()
    .select({value: sql<bigint>`count(*)`.mapWith(BigInt)})
    .from(attemptStreams)
    .where(eq(attemptStreams.state, 'open'));

  return row?.value ?? 0n;
}

/**
 * Lists expired closed streams for retention. `excludeIds` keeps failed or raced rows from
 * starving younger rows in the same run, and avoids cursoring on `closed_at`, whose microsecond
 * precision would be lost through JS `Date`.
 *
 * No `object_key` filter: retention deletes compacted and never-compacted streams alike.
 */
export async function listExpiredClosedStreams(params: {
  retentionDays: number;
  limit: number;
  excludeIds?: string[] | undefined;
}): Promise<AttemptStream[]> {
  const rows = await db()
    .select()
    .from(attemptStreams)
    .where(
      and(
        eq(attemptStreams.state, 'closed'),
        lt(attemptStreams.closedAt, sql`now() - make_interval(days => ${params.retentionDays})`),
        params.excludeIds && params.excludeIds.length > 0
          ? notInArray(attemptStreams.id, params.excludeIds)
          : undefined,
      ),
    )
    .orderBy(asc(attemptStreams.closedAt), asc(attemptStreams.id))
    .limit(params.limit)
    .for('update', {skipLocked: true});

  return rows.map(toAttemptStream);
}

/**
 * Hard-deletes one expired stream row, guarded on the observed `object_key` so a racing
 * compaction publish leaves the row for the next sweep.
 */
export async function deleteExpiredStream(
  tx: Transaction,
  params: {streamId: string; observedObjectKey: string | null},
): Promise<{deleted: boolean; jobId: string | null}> {
  const [row] = await tx
    .delete(attemptStreams)
    .where(
      and(
        eq(attemptStreams.id, params.streamId),
        params.observedObjectKey === null
          ? isNull(attemptStreams.objectKey)
          : eq(attemptStreams.objectKey, params.observedObjectKey),
      ),
    )
    .returning({jobId: attemptStreams.jobId});

  return {deleted: Boolean(row), jobId: row?.jobId ?? null};
}

export async function accountingHasNoStreams(tx: Transaction, jobId: string): Promise<boolean> {
  const [row] = await tx
    .select({id: attemptStreams.id})
    .from(attemptStreams)
    .where(eq(attemptStreams.jobId, jobId))
    .limit(1);

  return !row;
}
