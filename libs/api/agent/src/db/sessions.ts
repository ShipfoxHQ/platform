import type {Harness} from '@shipfox/api-agent-dto';
import {and, eq, sql} from 'drizzle-orm';
import type {AgentSession} from '#core/entities/agent-session.js';
import {AgentSessionHeldError} from '#core/errors.js';
import {db, type Transaction} from './db.js';
import {sessions, toAgentSession} from './schema/sessions.js';

export interface CreateSessionParams {
  workspaceId: string;
  projectId: string;
  workflowRunAttemptId: string;
  key: string;
  harness: Harness;
  /** Rerun provenance: the source row this row was carried over from. */
  carriedFromSessionId?: string | null;
}

/**
 * Inserts a fresh session row (empty head, no claim). Fails on the
 * `(workflow_run_attempt_id, key)` unique constraint, so callers that may
 * collide must handle or pre-empt the conflict (see `claimSession` and
 * `carryOverSessions`).
 */
export async function createSession(
  tx: Transaction,
  params: CreateSessionParams,
): Promise<AgentSession> {
  const rows = await tx
    .insert(sessions)
    .values({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      workflowRunAttemptId: params.workflowRunAttemptId,
      key: params.key,
      harness: params.harness,
      carriedFromSessionId: params.carriedFromSessionId ?? null,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Session insert returned no rows');
  return toAgentSession(row);
}

export interface ClaimSessionParams {
  workspaceId: string;
  projectId: string;
  workflowRunAttemptId: string;
  key: string;
  /** Harness pinned at creation; only applies on first use. */
  harness: Harness;
  stepAttemptId: string;
}

/**
 * Claims a session exclusively for a step attempt, in one short transaction
 * with a `FOR UPDATE` row lock. First use creates the session (empty head,
 * harness pinned to the caller's resolved harness). An unclaimed session, or
 * one already claimed by the same attempt, is granted; a session claimed by
 * another live attempt fails fast with `AgentSessionHeldError` — no waiting,
 * no queue. The create path uses `ON CONFLICT DO NOTHING` so two concurrent
 * first claims serialize on the unique index instead of racing on the insert.
 */
export async function claimSession(params: ClaimSessionParams): Promise<AgentSession> {
  return await db().transaction(async (tx) => {
    await tx
      .insert(sessions)
      .values({
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        workflowRunAttemptId: params.workflowRunAttemptId,
        key: params.key,
        harness: params.harness,
      })
      .onConflictDoNothing();

    const [row] = await tx
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.workflowRunAttemptId, params.workflowRunAttemptId),
          eq(sessions.key, params.key),
        ),
      )
      .for('update');
    if (!row) throw new Error('Session missing after claim create');

    if (row.claimedByStepAttempt !== null && row.claimedByStepAttempt !== params.stepAttemptId) {
      throw new AgentSessionHeldError({
        sessionId: row.id,
        workflowRunAttemptId: params.workflowRunAttemptId,
        key: params.key,
        heldByStepAttempt: row.claimedByStepAttempt,
      });
    }

    const updated = await tx
      .update(sessions)
      .set({
        claimedByStepAttempt: params.stepAttemptId,
        claimedAt: sql`now()`,
        updatedAt: sql`now()`,
        version: sql`${sessions.version} + 1`,
      })
      .where(eq(sessions.id, row.id))
      .returning();

    const updatedRow = updated[0];
    if (!updatedRow) throw new Error('Session update returned no rows after claim');
    return toAgentSession(updatedRow);
  });
}

/**
 * Releases the exclusive claim. Guarded on the claiming attempt: a release
 * only clears a claim the caller still holds, and is a no-op otherwise, so a
 * stale termination event can never steal a claim another attempt just took.
 * Returns whether this call cleared the claim.
 */
export async function releaseSession(params: {
  sessionId: string;
  stepAttemptId: string;
}): Promise<boolean> {
  const rows = await db()
    .update(sessions)
    .set({
      claimedByStepAttempt: null,
      claimedAt: null,
      updatedAt: sql`now()`,
      version: sql`${sessions.version} + 1`,
    })
    .where(
      and(
        eq(sessions.id, params.sessionId),
        eq(sessions.claimedByStepAttempt, params.stepAttemptId),
      ),
    )
    .returning({id: sessions.id});

  return rows.length > 0;
}

/**
 * Rerun `failed` carry-over: copies every session of the source run attempt
 * into the target attempt as fresh rows, with the head pointer (segment,
 * object key, size, committing attempt, repo ref) and pinned harness copied
 * and `carried_from_session_id` recording the provenance. Claims are never
 * carried. The insert is idempotent per `(workflow_run_attempt_id, key)`, so a
 * repeated carry-over call returns the same target rows instead of
 * duplicating them.
 */
export async function carryOverSessions(params: {
  fromWorkflowRunAttemptId: string;
  toWorkflowRunAttemptId: string;
}): Promise<AgentSession[]> {
  return await db().transaction(async (tx) => {
    const sourceRows = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.workflowRunAttemptId, params.fromWorkflowRunAttemptId));

    for (const source of sourceRows) {
      await tx
        .insert(sessions)
        .values({
          workspaceId: source.workspaceId,
          projectId: source.projectId,
          workflowRunAttemptId: params.toWorkflowRunAttemptId,
          key: source.key,
          harness: source.harness,
          harnessSessionId: source.harnessSessionId,
          headSegment: source.headSegment,
          headObjectKey: source.headObjectKey,
          headSizeBytes: source.headSizeBytes,
          headCommittedByAttempt: source.headCommittedByAttempt,
          headRepoRef: source.headRepoRef,
          carriedFromSessionId: source.id,
        })
        .onConflictDoNothing({
          target: [sessions.workflowRunAttemptId, sessions.key],
        });
    }

    const carried = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.workflowRunAttemptId, params.toWorkflowRunAttemptId));
    return carried.map(toAgentSession);
  });
}

export type HeadFlipOutcome = 'committed' | 'retry-acked' | 'conflict';

export interface CommitSessionHeadParams {
  sessionId: string;
  /** The step attempt reporting the segment; must hold the claim to commit. */
  stepAttemptId: string;
  /** The head segment the caller loaded (the segment being extended). */
  baseSegment: number;
  /** Storage key of the newly written transcript artifact. */
  headObjectKey: string;
  /** Compressed size of the newly written transcript artifact. */
  headSizeBytes: number;
  /** Checkout ref the segment ran on (preamble/audit metadata). */
  headRepoRef: string | null;
}

export interface CommitSessionHeadResult {
  outcome: HeadFlipOutcome;
  /** Current session state; null only when the session row is gone. */
  session: AgentSession | null;
}

/**
 * Advances the session head exactly once per reported attempt, under a
 * `FOR UPDATE` row lock so the segment CAS is atomic:
 *
 * * `committed` — the caller holds the claim and `baseSegment` equals the
 *   head; the head flips to `baseSegment + 1` and is stamped with the caller.
 * * `retry-acked` — the head is already `baseSegment + 1` and
 *   `head_committed_by_attempt` is the caller: the caller's first commit
 *   landed and this is a duplicate POST; nothing is rewritten.
 * * `conflict` — every other combination: a caller without the claim (zombie
 *   writer), a stale base, or a duplicate from a superseded attempt can never
 *   land.
 */
export async function commitSessionHead(
  params: CommitSessionHeadParams,
): Promise<CommitSessionHeadResult> {
  return await db().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, params.sessionId))
      .for('update');
    if (!row) return {outcome: 'conflict', session: null};

    if (
      row.headSegment === params.baseSegment &&
      row.claimedByStepAttempt === params.stepAttemptId
    ) {
      const updated = await tx
        .update(sessions)
        .set({
          headSegment: params.baseSegment + 1,
          headObjectKey: params.headObjectKey,
          headSizeBytes: params.headSizeBytes,
          headCommittedByAttempt: params.stepAttemptId,
          headRepoRef: params.headRepoRef,
          updatedAt: sql`now()`,
          version: sql`${sessions.version} + 1`,
        })
        .where(eq(sessions.id, params.sessionId))
        .returning();

      const updatedRow = updated[0];
      if (!updatedRow) throw new Error('Session update returned no rows after head flip');
      return {outcome: 'committed', session: toAgentSession(updatedRow)};
    }

    const session = toAgentSession(row);
    if (
      row.headSegment === params.baseSegment + 1 &&
      row.headCommittedByAttempt === params.stepAttemptId
    ) {
      return {outcome: 'retry-acked', session};
    }
    return {outcome: 'conflict', session};
  });
}
