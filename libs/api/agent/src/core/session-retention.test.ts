import crypto from 'node:crypto';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {eq, sql} from 'drizzle-orm';
import {config} from '#config.js';
import type {AgentSession} from '#core/entities/agent-session.js';
import {
  createSessionArtifactStore,
  createSessionKeyProvider,
  decodeBase64SessionKek,
  type SegmentManifest,
  SessionDekManager,
  sessionObjectKey,
} from '#core/session-artifacts/index.js';
import {listSessionObjectKeys} from '#core/session-artifacts/object-storage.js';
import {runSessionRetentionSweep} from '#core/session-retention.js';
import {
  claimSession,
  commitSessionHead,
  createSession,
  db,
  releaseSession,
  sessions,
} from '#db/index.js';

const KEK = decodeBase64SessionKek(
  config.AGENT_SESSION_ENCRYPTION_KEK,
  'AGENT_SESSION_ENCRYPTION_KEK',
);
const store = createSessionArtifactStore({
  dekManager: new SessionDekManager(createSessionKeyProvider(KEK), {
    maxEntries: 32,
    ttlMs: 60_000,
  }),
});

const GRACE_SECONDS = 600;
const RETENTION_DAYS = 90;

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

function manifest(committedByStepAttempt: string): SegmentManifest {
  return {
    harness: 'pi',
    sdkVersion: '0.82.0',
    model: 'gpt-5.2',
    provider: 'openai',
    committedByStepAttempt,
  };
}

async function arrangeSession(ctx: SessionCtx): Promise<AgentSession> {
  await db().transaction((tx) =>
    createSession(tx, {
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      workflowRunAttemptId: ctx.workflowRunAttemptId,
      key: ctx.key,
      harness: 'pi',
    }),
  );
  return claimSession({
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    workflowRunAttemptId: ctx.workflowRunAttemptId,
    key: ctx.key,
    harness: 'pi',
    stepAttemptId: ctx.stepAttemptId,
  });
}

/** Writes segment objects and advances the head to `headSegment`, returning the head object key. */
async function arrangeHead(
  session: AgentSession,
  ctx: SessionCtx,
  headSegment: number,
): Promise<string> {
  let headObjectKey: string | null = null;
  for (let segment = 1; segment <= headSegment; segment += 1) {
    const put = await store.putSegment({
      session,
      segment,
      blob: Buffer.from(`segment ${segment}`),
      manifest: manifest(ctx.stepAttemptId),
    });
    const flip = await commitSessionHead({
      sessionId: session.id,
      stepAttemptId: ctx.stepAttemptId,
      baseSegment: segment - 1,
      headObjectKey: put.objectKey,
      headSizeBytes: put.sizeBytes,
      headRepoRef: null,
    });
    if (flip.outcome !== 'committed') throw new Error(`arrangeHead flip failed: ${flip.outcome}`);
    headObjectKey = put.objectKey;
  }
  if (headObjectKey === null) throw new Error('arrangeHead wrote no head object');
  return headObjectKey;
}

async function writeOrphan(session: AgentSession, segment: number): Promise<void> {
  await store.putSegment({
    session,
    segment,
    blob: Buffer.from(`orphan ${segment}`),
    manifest: manifest(crypto.randomUUID()),
  });
}

function sessionKeys(session: AgentSession): Promise<string[]> {
  return listSessionObjectKeys(
    `${config.AGENT_SESSION_STORAGE_S3_PREFIX}/${session.workspaceId}/${session.workflowRunAttemptId}/${session.id}`,
  );
}

async function backdate(
  sessionId: string,
  column: 'retiredAt' | 'updatedAt',
  interval: string,
): Promise<void> {
  await db()
    .update(sessions)
    .set({[column]: sql`now() - ${interval}::interval`})
    .where(eq(sessions.id, sessionId));
}

async function findSession(sessionId: string) {
  const [row] = await db().select().from(sessions).where(eq(sessions.id, sessionId));
  return row ?? null;
}

async function cleanupArtifacts(): Promise<void> {
  const {deleteSessionObjects} = await import('#core/session-artifacts/object-storage.js');
  const keys = await listSessionObjectKeys(`${config.AGENT_SESSION_STORAGE_S3_PREFIX}/`);
  if (keys.length > 0) await deleteSessionObjects(keys);
}

function sweep(overrides: Partial<Parameters<typeof runSessionRetentionSweep>[0]> = {}) {
  return runSessionRetentionSweep({
    retentionDays: RETENTION_DAYS,
    segmentGraceSeconds: GRACE_SECONDS,
    batchLimit: 100,
    timeBudgetMs: 60_000,
    maxIterations: 100,
    ...overrides,
  });
}

describe('session retention sweep', () => {
  afterEach(async () => {
    await cleanupArtifacts();
    await db().execute(sql`TRUNCATE agent_sessions CASCADE`);
    await db().execute(sql`TRUNCATE agent_data_keys CASCADE`);
  });

  it('deletes expired sessions: objects before the row, and only after the retention window', async () => {
    const expired = newCtx();
    const expiredSession = await arrangeSession(expired);
    await arrangeHead(expiredSession, expired, 2);
    await backdate(expiredSession.id, 'retiredAt', '100 days');

    const fresh = newCtx();
    const freshSession = await arrangeSession(fresh);
    await arrangeHead(freshSession, fresh, 1);
    await backdate(freshSession.id, 'retiredAt', '100 days');

    // A retired-but-young session must survive the sweep.
    const young = newCtx();
    const youngSession = await arrangeSession(young);
    await arrangeHead(youngSession, young, 1);
    await backdate(youngSession.id, 'retiredAt', '10 days');

    const result = await sweep();

    expect(await findSession(expiredSession.id)).toBeNull();
    expect(await sessionKeys(expiredSession)).toHaveLength(0);
    expect(await findSession(freshSession.id)).toBeNull();
    expect(await sessionKeys(freshSession)).toHaveLength(0);
    expect(await findSession(youngSession.id)).not.toBeNull();
    expect(await sessionKeys(youngSession)).not.toHaveLength(0);
    expect(result.sessionsDeleted).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('keeps the head object while a carried-over rerun row still references it', async () => {
    const source = newCtx();
    const sourceSession = await arrangeSession(source);
    const headKey = await arrangeHead(sourceSession, source, 2);
    await backdate(sourceSession.id, 'retiredAt', '100 days');

    // Carried-over target row in a new run attempt, sharing the source head object.
    const target = newCtx();
    const targetSession = await db().transaction((tx) =>
      createSession(tx, {
        workspaceId: target.workspaceId,
        projectId: target.projectId,
        workflowRunAttemptId: target.workflowRunAttemptId,
        key: target.key,
        harness: 'pi',
      }),
    );
    const [targetRow] = await db()
      .update(sessions)
      .set({
        headSegment: 2,
        headObjectKey: headKey,
        headSizeBytes: 64,
        headCommittedByAttempt: source.stepAttemptId,
      })
      .where(eq(sessions.id, targetSession.id))
      .returning();
    expect(targetRow).not.toBeNull();

    const result = await sweep();

    // The source row is gone and its superseded segment is pruned, but the shared
    // head object survives until the referencing target row expires.
    expect(await findSession(sourceSession.id)).toBeNull();
    const sourceKeys = await sessionKeys(sourceSession);
    expect(sourceKeys).toEqual([headKey]);
    expect(await findSession(targetSession.id)).not.toBeNull();

    // Expire the target too: now the shared object goes with it.
    await backdate(targetSession.id, 'retiredAt', '100 days');
    await sweep();
    expect(await findSession(targetSession.id)).toBeNull();
    expect(
      await listSessionObjectKeys(
        `${config.AGENT_SESSION_STORAGE_S3_PREFIX}/${source.workspaceId}`,
      ),
    ).toHaveLength(0);
    expect(result.failed).toBe(0);
  });

  it('prunes superseded segments after the grace, keeping the head', async () => {
    const ctx = newCtx();
    const session = await arrangeSession(ctx);
    const headKey = await arrangeHead(session, ctx, 3);
    // Release the claim and let the grace elapse.
    await releaseSession({sessionId: session.id, stepAttemptId: ctx.stepAttemptId});
    await backdate(session.id, 'updatedAt', '2 hours');

    const result = await sweep();

    const keys = await sessionKeys(session);
    expect(keys).toHaveLength(1);
    expect(keys).toEqual([headKey]);
    expect(result.supersededPruned).toBe(2);
    expect(await findSession(session.id)).not.toBeNull();
  });

  it('does not prune superseded segments while the grace is still running', async () => {
    const ctx = newCtx();
    const session = await arrangeSession(ctx);
    await arrangeHead(session, ctx, 2);
    await releaseSession({sessionId: session.id, stepAttemptId: ctx.stepAttemptId});
    await backdate(session.id, 'updatedAt', '1 minute');

    const result = await sweep();

    expect(await sessionKeys(session)).toHaveLength(2);
    expect(result.supersededPruned).toBe(0);
  });

  it('collects orphans of unclaimed sessions but keeps those of claimed sessions', async () => {
    const released = newCtx();
    const releasedSession = await arrangeSession(released);
    const releasedHeadKey = await arrangeHead(releasedSession, released, 1);
    await writeOrphan(releasedSession, 2);
    await releaseSession({sessionId: releasedSession.id, stepAttemptId: released.stepAttemptId});
    await backdate(releasedSession.id, 'updatedAt', '2 hours');

    const claimed = newCtx();
    const claimedSession = await arrangeSession(claimed);
    const claimedHeadKey = await arrangeHead(claimedSession, claimed, 1);
    await writeOrphan(claimedSession, 2);
    await backdate(claimedSession.id, 'updatedAt', '2 hours');

    const result = await sweep();

    // The unclaimed session's orphan (a crash between write and head flip) is
    // collected; the claimed session's in-flight candidate is left alone.
    const releasedKeys = await sessionKeys(releasedSession);
    expect(releasedKeys).toEqual([releasedHeadKey]);
    expect(await sessionKeys(claimedSession)).toHaveLength(2);
    expect(result.orphansPruned).toBe(1);

    // Once the claim is released and the grace elapses again, the orphan goes too.
    await releaseSession({sessionId: claimedSession.id, stepAttemptId: claimed.stepAttemptId});
    await backdate(claimedSession.id, 'updatedAt', '2 hours');
    await sweep();
    expect(await sessionKeys(claimedSession)).toEqual([claimedHeadKey]);
  });

  it('deletes the carried-over exact head key even when it lives outside the session prefix', async () => {
    const target = newCtx();
    const targetSession = await arrangeSession(target);
    // A head object under another run attempt's prefix (carried-over pointer).
    const foreignRunAttemptId = crypto.randomUUID();
    const foreignSessionId = crypto.randomUUID();
    const foreignKey = sessionObjectKey(config.AGENT_SESSION_STORAGE_S3_PREFIX, {
      workspaceId: target.workspaceId,
      workflowRunAttemptId: foreignRunAttemptId,
      sessionId: foreignSessionId,
      segment: 1,
    });
    const put = await store.putSegment({
      session: {
        ...targetSession,
        id: foreignSessionId,
        workflowRunAttemptId: foreignRunAttemptId,
      } as AgentSession,
      segment: 1,
      blob: Buffer.from('foreign segment'),
      manifest: manifest(crypto.randomUUID()),
    });
    expect(put.objectKey).toBe(foreignKey);
    const [row] = await db()
      .update(sessions)
      .set({
        headSegment: 1,
        headObjectKey: foreignKey,
        headSizeBytes: 64,
        headCommittedByAttempt: crypto.randomUUID(),
      })
      .where(eq(sessions.id, targetSession.id))
      .returning();
    expect(row).not.toBeNull();
    await backdate(targetSession.id, 'retiredAt', '100 days');

    await sweep();

    expect(await findSession(targetSession.id)).toBeNull();
    expect(
      await listSessionObjectKeys(
        `${config.AGENT_SESSION_STORAGE_S3_PREFIX}/${target.workspaceId}`,
      ),
    ).toHaveLength(0);
  });

  it('respects the wall-clock budget', async () => {
    const ctx = newCtx();
    const session = await arrangeSession(ctx);
    await arrangeHead(session, ctx, 2);
    await releaseSession({sessionId: session.id, stepAttemptId: ctx.stepAttemptId});
    await backdate(session.id, 'updatedAt', '2 hours');

    let clock = 0;
    const result = await sweep({
      now: () => {
        clock += 1_000;
        return clock;
      },
      timeBudgetMs: 1,
    });

    expect(result.timedOut).toBe(true);
    expect(await sessionKeys(session)).toHaveLength(2);
  });
});
