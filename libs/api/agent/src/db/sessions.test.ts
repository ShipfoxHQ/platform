import crypto from 'node:crypto';
import {eq} from 'drizzle-orm';
import {
  AgentSessionCarryOverConflictError,
  AgentSessionHarnessInvalidError,
  AgentSessionHarnessMismatchError,
  AgentSessionHeldError,
  AgentSessionKeyInvalidError,
  AgentSessionLockUnavailableError,
} from '#core/errors.js';
import {
  carryOverSessions,
  claimSession,
  commitSessionHead,
  createSession,
  db,
  releaseSession,
  sessions,
} from '#db/index.js';

interface SessionCtx {
  workspaceId: string;
  projectId: string;
  workflowRunAttemptId: string;
  key: string;
  stepAttemptId: string;
}

function newCtx(overrides: Partial<SessionCtx> = {}): SessionCtx {
  return {
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    key: 'main',
    stepAttemptId: crypto.randomUUID(),
    ...overrides,
  };
}

async function findSession(sessionId: string) {
  const [row] = await db().select().from(sessions).where(eq(sessions.id, sessionId));
  return row ?? null;
}

function commitParams(sessionId: string, stepAttemptId: string, baseSegment: number) {
  return {
    sessionId,
    stepAttemptId,
    baseSegment,
    headObjectKey: `agent-sessions/${crypto.randomUUID()}/segments/${baseSegment + 1}`,
    headSizeBytes: 128,
    headRepoRef: 'refs/heads/main',
  };
}

describe('createSession', () => {
  it('creates a fresh session with an empty head and no claim', async () => {
    const ctx = newCtx();

    const created = await db().transaction((tx) =>
      createSession(tx, {
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        workflowRunAttemptId: ctx.workflowRunAttemptId,
        key: ctx.key,
        harness: 'pi',
      }),
    );

    expect(created).toMatchObject({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      workflowRunAttemptId: ctx.workflowRunAttemptId,
      key: ctx.key,
      harness: 'pi',
      harnessSessionId: null,
      headSegment: 0,
      headObjectKey: null,
      headSizeBytes: null,
      headCommittedByAttempt: null,
      headRepoRef: null,
      claimedByStepAttempt: null,
      claimedAt: null,
      carriedFromSessionId: null,
      version: 1,
    });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
  });

  it('rejects a duplicate key within the same run attempt', async () => {
    const ctx = newCtx();
    const params = {
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      workflowRunAttemptId: ctx.workflowRunAttemptId,
      key: ctx.key,
      harness: 'pi' as const,
    };
    await db().transaction((tx) => createSession(tx, params));

    const duplicate = db().transaction((tx) => createSession(tx, params));

    await expect(duplicate).rejects.toThrow();
    const rows = await db()
      .select()
      .from(sessions)
      .where(eq(sessions.workflowRunAttemptId, ctx.workflowRunAttemptId));
    expect(rows).toHaveLength(1);
  });

  it.each([
    '',
    'invalid/key',
    'a'.repeat(129),
  ])('rejects an invalid session key at the persistence boundary: %s', async (key) => {
    const ctx = newCtx({key});

    const act = db().transaction((tx) =>
      createSession(tx, {
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        workflowRunAttemptId: ctx.workflowRunAttemptId,
        key: ctx.key,
        harness: 'pi',
      }),
    );

    await expect(act).rejects.toBeInstanceOf(AgentSessionKeyInvalidError);
  });

  it('rejects an invalid harness at the persistence boundary', async () => {
    const ctx = newCtx();

    const act = db().transaction((tx) =>
      createSession(tx, {
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        workflowRunAttemptId: ctx.workflowRunAttemptId,
        key: ctx.key,
        harness: 'unknown' as never,
      }),
    );

    await expect(act).rejects.toBeInstanceOf(AgentSessionHarnessInvalidError);
  });

  it('allows the same key in different run attempts', async () => {
    const ctx = newCtx();
    const params = {
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      key: ctx.key,
      harness: 'pi' as const,
    };

    const first = await db().transaction((tx) =>
      createSession(tx, {...params, workflowRunAttemptId: crypto.randomUUID()}),
    );
    const second = await db().transaction((tx) =>
      createSession(tx, {...params, workflowRunAttemptId: crypto.randomUUID()}),
    );

    expect(first.id).not.toBe(second.id);
  });
});

describe('claimSession', () => {
  it('creates and claims a session on first use, pinning the harness', async () => {
    const ctx = newCtx();

    const claimed = await claimSession({
      ...ctx,
      harness: 'claude',
    });

    expect(claimed).toMatchObject({
      workflowRunAttemptId: ctx.workflowRunAttemptId,
      key: ctx.key,
      harness: 'claude',
      headSegment: 0,
      claimedByStepAttempt: ctx.stepAttemptId,
    });
    expect(claimed.claimedAt).toBeInstanceOf(Date);
  });

  it('grants a re-claim by the same attempt', async () => {
    const ctx = newCtx();
    const first = await claimSession({...ctx, harness: 'pi'});
    const firstClaimedAt = first.claimedAt?.getTime();

    const reClaimed = await claimSession({...ctx, harness: 'pi'});

    expect(reClaimed.id).toBe(first.id);
    expect(reClaimed.claimedByStepAttempt).toBe(ctx.stepAttemptId);
    expect(reClaimed.claimedAt?.getTime()).toBeGreaterThanOrEqual(firstClaimedAt ?? 0);
  });

  it('rejects a re-claim whose harness differs from the pinned harness', async () => {
    const ctx = newCtx();
    const first = await claimSession({...ctx, harness: 'pi'});

    const act = claimSession({...ctx, harness: 'claude'});

    await expect(act).rejects.toMatchObject({
      name: 'AgentSessionHarnessMismatchError',
      code: 'agent_session_harness_mismatch',
      pinnedHarness: 'pi',
      requestedHarness: 'claude',
    });
    await expect(act).rejects.toBeInstanceOf(AgentSessionHarnessMismatchError);
    const row = await findSession(first.id);
    expect(row).toMatchObject({harness: 'pi', claimedByStepAttempt: ctx.stepAttemptId});
  });

  it('grants a claim to another attempt once the holder released it', async () => {
    const ctx = newCtx();
    const first = await claimSession({...ctx, harness: 'pi'});
    await releaseSession({sessionId: first.id, stepAttemptId: ctx.stepAttemptId});

    const second = await claimSession({...ctx, stepAttemptId: crypto.randomUUID(), harness: 'pi'});

    expect(second.id).toBe(first.id);
    expect(second.claimedByStepAttempt).not.toBe(ctx.stepAttemptId);
    expect(second.harness).toBe('pi');
  });

  it('fails fast when another live attempt holds the claim', async () => {
    const ctx = newCtx();
    const holder = crypto.randomUUID();
    const held = await claimSession({...ctx, stepAttemptId: holder, harness: 'pi'});

    const act = claimSession({...ctx, harness: 'pi'});

    await expect(act).rejects.toBeInstanceOf(AgentSessionHeldError);
    await expect(act).rejects.toMatchObject({
      name: 'AgentSessionHeldError',
      workflowRunAttemptId: ctx.workflowRunAttemptId,
      key: ctx.key,
      heldByStepAttempt: holder,
    });
    const row = await findSession(held.id);
    expect(row?.claimedByStepAttempt).toBe(holder);
  });

  it('fails fast when another transaction holds the session row lock', async () => {
    const ctx = newCtx();
    const claimed = await claimSession({...ctx, harness: 'pi'});
    let releaseLock!: () => void;
    let resolveLockReady!: () => void;
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockReady = new Promise<void>((resolve) => {
      resolveLockReady = resolve;
    });
    const lockHolder = db().transaction(async (tx) => {
      await tx.select().from(sessions).where(eq(sessions.id, claimed.id)).for('update');
      resolveLockReady();
      await lockReleased;
    });
    await lockReady;

    const act = claimSession({...ctx, harness: 'pi', stepAttemptId: crypto.randomUUID()});
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let outcome: unknown;
    try {
      outcome = await Promise.race([
        act.then(
          () => 'completed' as const,
          (error: unknown) => error,
        ),
        new Promise<'timeout'>((resolve) => {
          timeoutId = setTimeout(() => resolve('timeout'), 1_000);
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      releaseLock();
      await lockHolder;
      await act.catch(() => undefined);
    }

    expect(
      outcome instanceof AgentSessionHeldError ||
        outcome instanceof AgentSessionLockUnavailableError,
    ).toBe(true);
  });

  it('keeps the held row untouched when a conflicting claim fails', async () => {
    const ctx = newCtx();
    const holder = crypto.randomUUID();
    const claimed = await claimSession({...ctx, stepAttemptId: holder, harness: 'pi'});

    await expect(claimSession({...ctx, harness: 'pi'})).rejects.toBeInstanceOf(
      AgentSessionHeldError,
    );

    const row = await findSession(claimed.id);
    expect(row).toMatchObject({
      claimedByStepAttempt: holder,
      headSegment: 0,
      version: 2,
    });
  });

  it('serializes two concurrent first claims into one grant and one held error', async () => {
    const ctx = newCtx();
    const otherAttempt = crypto.randomUUID();

    const results = await Promise.allSettled([
      claimSession({...ctx, harness: 'pi'}),
      claimSession({...ctx, stepAttemptId: otherAttempt, harness: 'pi'}),
    ]);

    const granted = results.filter((r) => r.status === 'fulfilled');
    const held = results.filter((r) => r.status === 'rejected');
    expect(granted).toHaveLength(1);
    expect(held).toHaveLength(1);
    expect((held[0] as PromiseRejectedResult).reason).toBeInstanceOf(AgentSessionHeldError);

    const rows = await db()
      .select()
      .from(sessions)
      .where(eq(sessions.workflowRunAttemptId, ctx.workflowRunAttemptId));
    expect(rows).toHaveLength(1);
  });
});

describe('releaseSession', () => {
  it('releases the caller own claim', async () => {
    const ctx = newCtx();
    const claimed = await claimSession({...ctx, harness: 'pi'});

    const released = await releaseSession({
      sessionId: claimed.id,
      stepAttemptId: ctx.stepAttemptId,
    });

    expect(released).toBe(true);
    const row = await findSession(claimed.id);
    expect(row?.claimedByStepAttempt).toBeNull();
    expect(row?.claimedAt).toBeNull();
  });

  it('does not release a claim held by another attempt', async () => {
    const ctx = newCtx();
    const holder = crypto.randomUUID();
    const claimed = await claimSession({...ctx, stepAttemptId: holder, harness: 'pi'});

    const released = await releaseSession({
      sessionId: claimed.id,
      stepAttemptId: ctx.stepAttemptId,
    });

    expect(released).toBe(false);
    const row = await findSession(claimed.id);
    expect(row?.claimedByStepAttempt).toBe(holder);
  });

  it('is a no-op when the session is already released', async () => {
    const ctx = newCtx();
    const claimed = await claimSession({...ctx, harness: 'pi'});
    await releaseSession({sessionId: claimed.id, stepAttemptId: ctx.stepAttemptId});

    const releasedAgain = await releaseSession({
      sessionId: claimed.id,
      stepAttemptId: ctx.stepAttemptId,
    });

    expect(releasedAgain).toBe(false);
  });
});

describe('carryOverSessions', () => {
  it('copies sessions into the target run attempt with provenance and the head pointer', async () => {
    const ctx = newCtx();
    const claimed = await claimSession({...ctx, harness: 'claude'});
    const headParams = commitParams(claimed.id, ctx.stepAttemptId, 0);
    await commitSessionHead(headParams);
    const targetRunAttemptId = crypto.randomUUID();

    const carried = await carryOverSessions({
      fromWorkflowRunAttemptId: ctx.workflowRunAttemptId,
      toWorkflowRunAttemptId: targetRunAttemptId,
    });

    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      workflowRunAttemptId: targetRunAttemptId,
      key: ctx.key,
      harness: 'claude',
      headSegment: 1,
      headObjectKey: headParams.headObjectKey,
      headSizeBytes: headParams.headSizeBytes,
      headCommittedByAttempt: ctx.stepAttemptId,
      headRepoRef: 'refs/heads/main',
      claimedByStepAttempt: null,
      claimedAt: null,
      carriedFromSessionId: claimed.id,
    });
    const carriedSession = carried[0];
    expect(carriedSession?.id).not.toBe(claimed.id);
    // The source row is untouched.
    const source = await findSession(claimed.id);
    expect(source?.workflowRunAttemptId).toBe(ctx.workflowRunAttemptId);
  });

  it('rejects carry-over when the target already has an unrelated session for the key', async () => {
    const ctx = newCtx();
    const source = await claimSession({...ctx, harness: 'pi'});
    const targetWorkflowRunAttemptId = crypto.randomUUID();
    const target = await claimSession({
      ...ctx,
      workflowRunAttemptId: targetWorkflowRunAttemptId,
      harness: 'pi',
    });

    const act = carryOverSessions({
      fromWorkflowRunAttemptId: ctx.workflowRunAttemptId,
      toWorkflowRunAttemptId: targetWorkflowRunAttemptId,
    });

    await expect(act).rejects.toBeInstanceOf(AgentSessionCarryOverConflictError);
    const row = await findSession(target.id);
    expect(row).toMatchObject({id: target.id, carriedFromSessionId: null});
    expect(source.id).not.toBe(target.id);
  });

  it('is idempotent for a repeated carry-over call', async () => {
    const ctx = newCtx();
    await claimSession({...ctx, harness: 'pi'});
    const targetRunAttemptId = crypto.randomUUID();
    const params = {
      fromWorkflowRunAttemptId: ctx.workflowRunAttemptId,
      toWorkflowRunAttemptId: targetRunAttemptId,
    };

    await carryOverSessions(params);
    const second = await carryOverSessions(params);

    expect(second).toHaveLength(1);
    const rows = await db()
      .select()
      .from(sessions)
      .where(eq(sessions.workflowRunAttemptId, targetRunAttemptId));
    expect(rows).toHaveLength(1);
  });

  it('carries over nothing for a source attempt without sessions', async () => {
    const carried = await carryOverSessions({
      fromWorkflowRunAttemptId: crypto.randomUUID(),
      toWorkflowRunAttemptId: crypto.randomUUID(),
    });

    expect(carried).toEqual([]);
  });
});

describe('commitSessionHead', () => {
  it('commits a new head segment from the claiming attempt', async () => {
    const ctx = newCtx();
    const claimed = await claimSession({...ctx, harness: 'pi'});
    const params = commitParams(claimed.id, ctx.stepAttemptId, 0);

    const result = await commitSessionHead(params);
    const session = result.session;

    expect(result.outcome).toBe('committed');
    expect(session).not.toBeNull();
    expect(session).toMatchObject({
      headSegment: 1,
      headObjectKey: params.headObjectKey,
      headSizeBytes: 128,
      headCommittedByAttempt: ctx.stepAttemptId,
      headRepoRef: 'refs/heads/main',
      claimedByStepAttempt: ctx.stepAttemptId,
    });
    expect(session?.id).toBe(claimed.id);
  });

  it('acks a retry without rewriting when the head is already the caller segment', async () => {
    const ctx = newCtx();
    const claimed = await claimSession({...ctx, harness: 'pi'});
    const params = commitParams(claimed.id, ctx.stepAttemptId, 0);
    await commitSessionHead(params);

    const retry = await commitSessionHead(params);

    expect(retry.outcome).toBe('retry-acked');
    expect(retry.session).toMatchObject({headSegment: 1, headObjectKey: params.headObjectKey});
  });

  it('acks a retry even after the claim was released', async () => {
    const ctx = newCtx();
    const claimed = await claimSession({...ctx, harness: 'pi'});
    const params = commitParams(claimed.id, ctx.stepAttemptId, 0);
    await commitSessionHead(params);
    await releaseSession({sessionId: claimed.id, stepAttemptId: ctx.stepAttemptId});

    const retry = await commitSessionHead(params);

    expect(retry.outcome).toBe('retry-acked');
    expect(retry.session?.headSegment).toBe(1);
  });

  it('rejects a duplicate commit from a different attempt (duplicate-commit)', async () => {
    const ctx = newCtx();
    const claimed = await claimSession({...ctx, harness: 'pi'});
    await commitSessionHead(commitParams(claimed.id, ctx.stepAttemptId, 0));

    const intruder = commitSessionHead(commitParams(claimed.id, crypto.randomUUID(), 0));

    await expect(intruder).resolves.toMatchObject({outcome: 'conflict'});
    const row = await findSession(claimed.id);
    expect(row?.headSegment).toBe(1);
    expect(row?.headCommittedByAttempt).toBe(ctx.stepAttemptId);
  });

  it('rejects a writer that never held the claim (zombie-writer)', async () => {
    const ctx = newCtx();
    const session = await db().transaction((tx) =>
      createSession(tx, {
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        workflowRunAttemptId: ctx.workflowRunAttemptId,
        key: ctx.key,
        harness: 'pi',
      }),
    );

    const zombie = await commitSessionHead(commitParams(session.id, ctx.stepAttemptId, 0));

    expect(zombie.outcome).toBe('conflict');
    const row = await findSession(session.id);
    expect(row?.headSegment).toBe(0);
    expect(row?.headObjectKey).toBeNull();
  });

  it('rejects a commit from an attempt whose claim was released (zombie-writer)', async () => {
    const ctx = newCtx();
    const claimed = await claimSession({...ctx, harness: 'pi'});
    await releaseSession({sessionId: claimed.id, stepAttemptId: ctx.stepAttemptId});

    const zombie = await commitSessionHead(commitParams(claimed.id, ctx.stepAttemptId, 0));

    expect(zombie.outcome).toBe('conflict');
    const row = await findSession(claimed.id);
    expect(row?.headSegment).toBe(0);
  });

  it('rejects a stale base from the claiming attempt', async () => {
    const ctx = newCtx();
    const claimed = await claimSession({...ctx, harness: 'pi'});
    await commitSessionHead(commitParams(claimed.id, ctx.stepAttemptId, 0));

    const stale = await commitSessionHead(commitParams(claimed.id, ctx.stepAttemptId, 1));
    const staleBase = await commitSessionHead(commitParams(claimed.id, ctx.stepAttemptId, 0));

    expect(stale.outcome).toBe('committed');
    expect(staleBase.outcome).toBe('conflict');
  });

  it('rejects a duplicate from a superseded attempt after the head advanced again', async () => {
    const ctx = newCtx();
    const claimed = await claimSession({...ctx, harness: 'pi'});
    await commitSessionHead(commitParams(claimed.id, ctx.stepAttemptId, 0));
    await commitSessionHead(commitParams(claimed.id, ctx.stepAttemptId, 1));

    const superseded = await commitSessionHead(commitParams(claimed.id, ctx.stepAttemptId, 0));

    expect(superseded.outcome).toBe('conflict');
    const row = await findSession(claimed.id);
    expect(row?.headSegment).toBe(2);
    expect(row?.headObjectKey).not.toBeNull();
  });

  it('keeps the committed head when a racing commit loses (concurrent CAS)', async () => {
    const ctx = newCtx();
    const claimed = await claimSession({...ctx, harness: 'pi'});
    const otherAttempt = crypto.randomUUID();
    const firstParams = commitParams(claimed.id, ctx.stepAttemptId, 0);
    const secondParams = commitParams(claimed.id, otherAttempt, 0);

    const results = await Promise.allSettled([
      commitSessionHead(firstParams),
      commitSessionHead(secondParams),
    ]);

    const outcomes = results.map((r) => (r.status === 'fulfilled' ? r.value.outcome : 'rejected'));
    expect(outcomes).toContain('committed');
    expect(outcomes).toContain('conflict');

    const row = await findSession(claimed.id);
    expect(row?.headSegment).toBe(1);
    expect(row?.headCommittedByAttempt).toBe(ctx.stepAttemptId);
  });
});
