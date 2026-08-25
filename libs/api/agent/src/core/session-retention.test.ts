import crypto from 'node:crypto';
import {afterEach, describe, expect, it, vi} from '@shipfox/vitest/vi';
import {eq, inArray, sql} from 'drizzle-orm';
import {config} from '#config.js';
import type {AgentSession} from '#core/entities/agent-session.js';
import {decodeBase64SessionKek} from '#core/session-artifacts/crypto.js';
import {SessionDekManager} from '#core/session-artifacts/dek-manager.js';
import {createSessionKeyProvider} from '#core/session-artifacts/key-provider.js';
import type {SegmentManifest} from '#core/session-artifacts/manifest.js';
import {sessionObjectKey} from '#core/session-artifacts/object-key.js';
import * as sessionObjectStorage from '#core/session-artifacts/object-storage.js';
import {createSessionArtifactStore} from '#core/session-artifacts/store.js';
import {runSessionRetentionSweep} from '#core/session-retention.js';
import {
  claimSession,
  commitSessionHead,
  createSession,
  db,
  releaseSession,
  sessionDataKeys,
  sessions,
} from '#db/index.js';

const {deleteSessionObjects: deleteSessionObjectKeys, listSessionObjectKeys} = sessionObjectStorage;

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
const workspaceIds = new Set<string>();

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
  const ctx = {
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    key: 'main',
    stepAttemptId: crypto.randomUUID(),
    ...overrides,
  };
  workspaceIds.add(ctx.workspaceId);
  return ctx;
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
  for (const workspaceId of workspaceIds) {
    const keys = await listSessionObjectKeys(
      `${config.AGENT_SESSION_STORAGE_S3_PREFIX}/${workspaceId}`,
    );
    if (keys.length > 0) await deleteSessionObjectKeys(keys);
  }
}

async function cleanupDatabase(): Promise<void> {
  const ids = [...workspaceIds];
  if (ids.length === 0) return;
  await db().delete(sessions).where(inArray(sessions.workspaceId, ids));
  await db().delete(sessionDataKeys).where(inArray(sessionDataKeys.workspaceId, ids));
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
    vi.restoreAllMocks();
    await cleanupArtifacts();
    await cleanupDatabase();
    workspaceIds.clear();
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

  it('advances through more prune candidates than fit in one batch', async () => {
    const sessionsToPrune: AgentSession[] = [];
    for (let index = 0; index < 3; index += 1) {
      const ctx = newCtx();
      const session = await arrangeSession(ctx);
      await arrangeHead(session, ctx, 2);
      await releaseSession({sessionId: session.id, stepAttemptId: ctx.stepAttemptId});
      await backdate(session.id, 'updatedAt', '2 hours');
      sessionsToPrune.push(session);
    }

    const result = await sweep({batchLimit: 1, maxIterations: 10});

    expect(result.supersededPruned).toBe(3);
    for (const session of sessionsToPrune) {
      expect(await sessionKeys(session)).toHaveLength(1);
    }
  });

  it('isolates one session deletion failure and retries it on the next sweep', async () => {
    const expiredSessions: AgentSession[] = [];
    for (let index = 0; index < 2; index += 1) {
      const ctx = newCtx();
      const session = await arrangeSession(ctx);
      await arrangeHead(session, ctx, 1);
      await backdate(session.id, 'retiredAt', '100 days');
      expiredSessions.push(session);
    }
    vi.spyOn(sessionObjectStorage, 'deleteSessionObjects').mockRejectedValueOnce(
      new Error('injected object-store failure'),
    );

    const first = await sweep();

    expect(first.failed).toBe(1);
    expect(first.sessionsDeleted).toBe(1);
    const remaining: AgentSession[] = [];
    for (const session of expiredSessions) {
      if ((await findSession(session.id)) !== null) remaining.push(session);
    }
    expect(remaining).toHaveLength(1);
    const failedSession = remaining[0];
    if (!failedSession) throw new Error('Expected one failed session');
    expect(await sessionKeys(failedSession)).toHaveLength(1);

    vi.restoreAllMocks();
    const retry = await sweep();

    expect(retry.failed).toBe(0);
    expect(await findSession(failedSession.id)).toBeNull();
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
