import type {Harness} from '@shipfox/api-agent-dto';
import {WORKFLOW_SESSION_KEY_PATTERN} from '@shipfox/workflow-document';
import {and, eq, inArray, sql} from 'drizzle-orm';
import type {AgentSession} from '#core/entities/agent-session.js';
import {
  AgentSessionCarryOverConflictError,
  AgentSessionHarnessInvalidError,
  AgentSessionHarnessMismatchError,
  AgentSessionHeldError,
  AgentSessionKeyInvalidError,
  AgentSessionLockUnavailableError,
} from '#core/errors.js';
import {db, type Transaction} from './db.js';
import {type AgentSessionDb, sessions, toAgentSession} from './schema/sessions.js';

const AGENT_SESSION_CLAIM_LOCK_PREFIX = 'agent-session-claim:';

export function assertValidSessionKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !WORKFLOW_SESSION_KEY_PATTERN.test(key)) {
    throw new AgentSessionKeyInvalidError();
  }
}

function assertValidSessionHarness(harness: unknown): asserts harness is Harness {
  if (harness !== 'pi' && harness !== 'claude') {
    throw new AgentSessionHarnessInvalidError();
  }
}

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
  assertValidSessionKey(params.key);
  assertValidSessionHarness(params.harness);

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
  /** Harness resolved for this attempt; it must match an existing pinned session. */
  harness: Harness;
  stepAttemptId: string;
}

function assertSessionClaimable(row: AgentSessionDb, params: ClaimSessionParams): void {
  assertValidSessionKey(row.key);
  assertValidSessionHarness(row.harness);
  // Scope is part of claimability: a row that surfaces after an `ON CONFLICT
  // DO NOTHING` (a foreign row inserted between the initial SELECT and the
  // insert) was never covered by the caller's pre-insert scope assertion, so
  // re-verify the denormalized workspace/project match before classifying or
  // updating it.
  assertSessionScopeMatches(row, params);
  if (row.harness !== params.harness) {
    throw new AgentSessionHarnessMismatchError({
      sessionId: row.id,
      workflowRunAttemptId: params.workflowRunAttemptId,
      key: row.key,
      pinnedHarness: row.harness,
      requestedHarness: params.harness,
    });
  }

  if (row.claimedByStepAttempt !== null && row.claimedByStepAttempt !== params.stepAttemptId) {
    throw new AgentSessionHeldError({
      sessionId: row.id,
      workflowRunAttemptId: params.workflowRunAttemptId,
      key: row.key,
      heldByStepAttempt: row.claimedByStepAttempt,
    });
  }
}

/**
 * Defense-in-depth scope check: the session identity is the `(run attempt, key)`
 * pair, so a caller that forwards an attempt id from untrusted input could
 * otherwise read or claim a row belonging to another workspace/project. The
 * denormalized `workspace_id`/`project_id` must match the caller-supplied scope;
 * a mismatch is surfaced as `AgentSessionHeldError` (the row is held by another
 * scope's attempt context) rather than read across the boundary.
 */
function assertSessionScopeMatches(row: AgentSessionDb, params: ClaimSessionParams): void {
  if (row.workspaceId !== params.workspaceId || row.projectId !== params.projectId) {
    throw new AgentSessionHeldError({
      sessionId: row.id,
      workflowRunAttemptId: params.workflowRunAttemptId,
      key: row.key,
      heldByStepAttempt: row.claimedByStepAttempt,
    });
  }
}

async function tryAcquireSessionClaimLock(
  tx: Transaction,
  params: ClaimSessionParams,
): Promise<boolean> {
  const result = await tx.execute<{acquired: boolean}>(
    sql`select pg_try_advisory_xact_lock(hashtextextended(${`${AGENT_SESSION_CLAIM_LOCK_PREFIX}${params.workflowRunAttemptId}:${params.key}`}, 0)) as acquired`,
  );
  return result.rows[0]?.acquired === true;
}

function throwSessionHeld(row: AgentSessionDb, params: ClaimSessionParams): never {
  assertSessionClaimable(row, params);
  throw new AgentSessionHeldError({
    sessionId: row.id,
    workflowRunAttemptId: params.workflowRunAttemptId,
    key: row.key,
    heldByStepAttempt: row.claimedByStepAttempt,
  });
}

function claimSessionIdentity(params: ClaimSessionParams) {
  return and(
    eq(sessions.workflowRunAttemptId, params.workflowRunAttemptId),
    eq(sessions.key, params.key),
  );
}

async function acquireExistingSessionClaim(
  tx: Transaction,
  row: AgentSessionDb | undefined,
  params: ClaimSessionParams,
): Promise<void> {
  if (!row) return;
  assertSessionScopeMatches(row, params);
  if (!(await tryAcquireSessionClaimLock(tx, params))) throwSessionHeld(row, params);
}

async function assertClaimLockAvailable(
  tx: Transaction,
  params: ClaimSessionParams,
): Promise<void> {
  if (await tryAcquireSessionClaimLock(tx, params)) return;
  const [visibleRow] = await tx.select().from(sessions).where(claimSessionIdentity(params));
  if (!visibleRow) throw new Error('Session missing after claim lock contention');
  throwSessionHeld(visibleRow, params);
}

async function lockClaimableSession(
  tx: Transaction,
  params: ClaimSessionParams,
): Promise<AgentSessionDb> {
  const [row] = await tx
    .select()
    .from(sessions)
    .where(claimSessionIdentity(params))
    .for('update', {skipLocked: true});
  if (row) {
    assertSessionClaimable(row, params);
    return row;
  }

  const [visibleRow] = await tx.select().from(sessions).where(claimSessionIdentity(params));
  if (!visibleRow) throw new Error('Session missing after claim create');
  assertSessionClaimable(visibleRow, params);
  throw new AgentSessionLockUnavailableError({
    sessionId: visibleRow.id,
    workflowRunAttemptId: params.workflowRunAttemptId,
    key: visibleRow.key,
  });
}

/**
 * Claims a session exclusively for a step attempt, in one short transaction
 * with a non-blocking `FOR UPDATE SKIP LOCKED` row lock. First use creates the session (empty head,
 * harness pinned to the caller's resolved harness). An unclaimed session, or
 * one already claimed by the same attempt, is granted; a session claimed by
 * another live attempt fails fast with `AgentSessionHeldError` — no waiting,
 * no queue. A re-claim with a different harness fails with
 * `AgentSessionHarnessMismatchError`. The create path uses `ON CONFLICT DO
 * NOTHING` so two concurrent first claims serialize on the unique index instead
 * of racing on the insert. A transaction advisory lock identifies another
 * in-flight claim even when its row update is not visible to this transaction.
 */
export async function claimSession(params: ClaimSessionParams): Promise<AgentSession> {
  assertValidSessionKey(params.key);
  assertValidSessionHarness(params.harness);

  return await db().transaction(async (tx) => {
    const [existingRow] = await tx.select().from(sessions).where(claimSessionIdentity(params));
    await acquireExistingSessionClaim(tx, existingRow, params);

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

    await assertClaimLockAvailable(tx, params);
    const row = await lockClaimableSession(tx, params);

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
 * Reads the session for a run attempt and resolved key without claiming it.
 * Scoped to the caller-supplied workspace and project so a forwarded attempt id
 * can never read another tenant's session. `fork` mode uses this: it never
 * claims and never writes back, so the caller only needs whatever head exists
 * (or nothing, for a fresh ephemeral run).
 */
export async function getSessionByRunAttemptAndKey(params: {
  workspaceId: string;
  projectId: string;
  workflowRunAttemptId: string;
  key: string;
}): Promise<AgentSession | undefined> {
  const [row] = await db()
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.workspaceId, params.workspaceId),
        eq(sessions.projectId, params.projectId),
        eq(sessions.workflowRunAttemptId, params.workflowRunAttemptId),
        eq(sessions.key, params.key),
      ),
    )
    .limit(1);
  return row ? toAgentSession(row) : undefined;
}

/**
 * Releases every claim held by the given step attempts, in one statement, and
 * returns how many claims were cleared. The `claimed_by_step_attempt` guard is
 * inherent: a row whose claim another attempt just took is untouched, so a
 * stale termination event can never steal a claim. Empty input releases
 * nothing.
 *
 * The optional `olderThanSeconds` cutoff (used by the reap cron) adds a
 * `claimed_at` staleness guard so only claims held past the cutoff are
 * cleared: an attempt that holds both a stale claim and a live one keeps the
 * live claim and its single-writer exclusivity.
 */
export async function releaseSessionClaimsHeldByStepAttempts(
  stepAttemptIds: string[],
  opts?: {olderThanSeconds?: number | undefined} | undefined,
): Promise<number> {
  if (stepAttemptIds.length === 0) return 0;

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
        inArray(sessions.claimedByStepAttempt, stepAttemptIds),
        ...(opts?.olderThanSeconds === undefined
          ? []
          : [sql`${sessions.claimedAt} < now() - make_interval(secs => ${opts.olderThanSeconds})`]),
      ),
    )
    .returning({id: sessions.id});

  return rows.length;
}

/**
 * Lists sessions whose claim has been held longer than `olderThanSeconds`
 * without a release. The reap cron's bounded sweep: a claim this old can no
 * longer be assumed live, so clearing it unblocks the key for the next attempt.
 * This is a backstop heuristic, not a liveness check: the job lease is renewed
 * on every runner heartbeat, so `olderThanSeconds` must exceed the longest job
 * execution duration for the deployment (see the AGENT_SESSION_REAP_AFTER_SECONDS
 * description). Bounded per tick; remaining stale claims are picked up on the
 * next cron run.
 */
export async function listStaleClaimedSessions(params: {
  olderThanSeconds: number;
  limit: number;
}): Promise<AgentSession[]> {
  const rows = await db()
    .select()
    .from(sessions)
    .where(
      and(
        sql`${sessions.claimedByStepAttempt} is not null`,
        sql`${sessions.claimedAt} < now() - make_interval(secs => ${params.olderThanSeconds})`,
      ),
    )
    .limit(params.limit);
  return rows.map(toAgentSession);
}

/**
 * Rerun `failed` carry-over: copies every session of the source run attempt
 * into the target attempt as fresh rows, with the head pointer (segment,
 * object key, size, committing attempt, repo ref) and pinned harness copied
 * and `carried_from_session_id` recording the provenance. Claims are never
 * carried. The insert is idempotent per `(workflow_run_attempt_id, key)`, so a
 * repeated carry-over call returns the same target rows instead of
 * duplicating them. Callers must invoke this after the source attempt is
 * terminal and harness-session termination has committed; workflow state is
 * owned by another database module and cannot be checked here. Source rows are
 * locked while their head pointers are copied.
 */
export async function carryOverSessions(params: {
  fromWorkflowRunAttemptId: string;
  toWorkflowRunAttemptId: string;
}): Promise<AgentSession[]> {
  return await db().transaction(async (tx) => {
    const sourceRows = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.workflowRunAttemptId, params.fromWorkflowRunAttemptId))
      .for('update');

    for (const source of sourceRows) {
      assertValidSessionKey(source.key);
      assertValidSessionHarness(source.harness);

      const [inserted] = await tx
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
        })
        .returning({id: sessions.id});

      if (!inserted) {
        const [existing] = await tx
          .select({id: sessions.id, carriedFromSessionId: sessions.carriedFromSessionId})
          .from(sessions)
          .where(
            and(
              eq(sessions.workflowRunAttemptId, params.toWorkflowRunAttemptId),
              eq(sessions.key, source.key),
            ),
          )
          .for('update');
        if (!existing) throw new Error('Session missing after carry-over conflict');
        if (existing.carriedFromSessionId !== source.id) {
          throw new AgentSessionCarryOverConflictError({
            targetWorkflowRunAttemptId: params.toWorkflowRunAttemptId,
            key: source.key,
            sourceSessionId: source.id,
            existingSessionId: existing.id,
          });
        }
      }
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
  /**
   * Harness-native session id reported by the committing runner. Set on the
   * row when the head flips; omitted (undefined) preserves the existing value
   * so an older runner that does not report one never wipes a carried-over id.
   */
  harnessSessionId?: string | undefined;
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
 *
 * Pass a `tx` to run the flip inside an existing transaction (the artifact
 * store holds the row lock across upload and flip so duplicate commits
 * serialize instead of racing an overwrite of the same object key).
 */
export function commitSessionHead(
  params: CommitSessionHeadParams,
  tx?: Transaction,
): Promise<CommitSessionHeadResult> {
  const run = async (executor: Transaction): Promise<CommitSessionHeadResult> => {
    const [row] = await executor
      .select()
      .from(sessions)
      .where(eq(sessions.id, params.sessionId))
      .for('update');
    if (!row) return {outcome: 'conflict', session: null};

    if (
      row.headSegment === params.baseSegment &&
      row.claimedByStepAttempt === params.stepAttemptId
    ) {
      const updated = await executor
        .update(sessions)
        .set({
          headSegment: params.baseSegment + 1,
          headObjectKey: params.headObjectKey,
          headSizeBytes: params.headSizeBytes,
          headCommittedByAttempt: params.stepAttemptId,
          ...(params.harnessSessionId !== undefined
            ? {harnessSessionId: params.harnessSessionId}
            : {}),
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
  };

  return tx ? run(tx) : db().transaction(run);
}
