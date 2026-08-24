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
import {claimSession, createSession, db, sessions} from '#db/index.js';

describe('session artifact store', () => {
  afterEach(async () => {
    await cleanupArtifacts();
    await db().execute(sql`TRUNCATE agent_sessions CASCADE`);
    await db().execute(sql`TRUNCATE agent_data_keys CASCADE`);
  });

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

  function manifest(overrides: Partial<SegmentManifest> = {}): SegmentManifest {
    return {
      harness: 'pi',
      sdkVersion: '0.82.0',
      model: 'gpt-5.2',
      provider: 'openai',
      committedByStepAttempt: crypto.randomUUID(),
      ...overrides,
    };
  }

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

  async function arrangeClaimedSession(ctx: SessionCtx): Promise<AgentSession> {
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

  async function findSessionRow(sessionId: string) {
    const [row] = await db().select().from(sessions).where(eq(sessions.id, sessionId));
    return row ?? null;
  }

  function requireSession(result: {session: AgentSession | null}): AgentSession {
    if (result.session === null) throw new Error('Expected a session in the result');
    return result.session;
  }

  async function objectExists(key: string): Promise<boolean> {
    const keys = await listSessionObjectKeys(key.split('/').slice(0, -1).join('/'));
    return keys.includes(key);
  }

  async function cleanupArtifacts(): Promise<void> {
    const {deleteSessionObjects} = await import('#core/session-artifacts/object-storage.js');
    const keys = await listSessionObjectKeys(`${config.AGENT_SESSION_STORAGE_S3_PREFIX}/`);
    if (keys.length > 0) await deleteSessionObjects(keys);
  }

  it('commits a segment: writes the encrypted object and flips the head', async () => {
    const ctx = newCtx();
    const session = await arrangeClaimedSession(ctx);
    const blob = Buffer.from('harness-native session file, gzipped');

    const result = await store.commitSegment({
      session,
      stepAttemptId: ctx.stepAttemptId,
      baseSegment: 0,
      blob,
      manifest: manifest({committedByStepAttempt: ctx.stepAttemptId}),
      headRepoRef: 'refs/heads/main',
    });

    expect(result.outcome).toBe('committed');
    expect(result.session?.headSegment).toBe(1);
    expect(result.session?.headObjectKey).toBe(
      sessionObjectKey(config.AGENT_SESSION_STORAGE_S3_PREFIX, {
        workspaceId: ctx.workspaceId,
        workflowRunAttemptId: ctx.workflowRunAttemptId,
        sessionId: session.id,
        segment: 1,
      }),
    );
    expect(result.session?.headSizeBytes).toBe(blob.length);

    // The stored object is encrypted: it must not contain the plaintext bytes.
    const stored = await listSessionObjectKeys(
      `${config.AGENT_SESSION_STORAGE_S3_PREFIX}/${ctx.workspaceId}/${ctx.workflowRunAttemptId}/${session.id}`,
    );
    expect(stored).toHaveLength(1);
    expect(stored).toEqual([result.session?.headObjectKey]);

    const read = await store.readHeadSegment({...session, ...requireSession(result)});
    expect(read?.blob).toEqual(blob);
    expect(read?.manifest).toMatchObject({
      harness: 'pi',
      sdkVersion: '0.82.0',
      model: 'gpt-5.2',
      provider: 'openai',
      committedByStepAttempt: ctx.stepAttemptId,
    });
  });

  it('round-trips the byte-exact blob through encrypt and decrypt', async () => {
    const ctx = newCtx();
    const session = await arrangeClaimedSession(ctx);
    // Deterministic payload so the round-trip is exact; a real session file is gzipped.
    const blob = Buffer.from(JSON.stringify({turns: [1, 2, 3], payload: 'x'.repeat(4096)}));

    const committed = await store.commitSegment({
      session,
      stepAttemptId: ctx.stepAttemptId,
      baseSegment: 0,
      blob,
      manifest: manifest({committedByStepAttempt: ctx.stepAttemptId}),
      headRepoRef: null,
    });
    expect(committed.outcome).toBe('committed');

    const read = await store.readHeadSegment(requireSession(committed));
    expect(read?.blob).toEqual(blob);
  });

  it('enforces the compressed blob cap with agent_session_unavailable', async () => {
    const ctx = newCtx();
    const session = await arrangeClaimedSession(ctx);
    const overCap = Buffer.alloc(config.AGENT_SESSION_BLOB_CAP_BYTES + 1);

    await expect(
      store.commitSegment({
        session,
        stepAttemptId: ctx.stepAttemptId,
        baseSegment: 0,
        blob: overCap,
        manifest: manifest({committedByStepAttempt: ctx.stepAttemptId}),
        headRepoRef: null,
      }),
    ).rejects.toMatchObject({code: 'agent_session_unavailable', reason: 'blob_cap_exceeded'});

    // Nothing was written and the head never moved.
    const row = await findSessionRow(session.id);
    expect(row?.headSegment).toBe(0);
    const keys = await listSessionObjectKeys(
      `${config.AGENT_SESSION_STORAGE_S3_PREFIX}/${ctx.workspaceId}/${ctx.workflowRunAttemptId}/${session.id}`,
    );
    expect(keys).toHaveLength(0);
  });

  it('acknowledges a retry without rewriting the head', async () => {
    const ctx = newCtx();
    const session = await arrangeClaimedSession(ctx);
    const blob = Buffer.from('first attempt bytes');

    const first = await store.commitSegment({
      session,
      stepAttemptId: ctx.stepAttemptId,
      baseSegment: 0,
      blob,
      manifest: manifest({committedByStepAttempt: ctx.stepAttemptId}),
      headRepoRef: null,
    });
    expect(first.outcome).toBe('committed');

    const retry = await store.commitSegment({
      session: requireSession(first),
      stepAttemptId: ctx.stepAttemptId,
      baseSegment: 0,
      blob,
      manifest: manifest({committedByStepAttempt: ctx.stepAttemptId}),
      headRepoRef: null,
    });
    expect(retry.outcome).toBe('retry-acked');
    expect(retry.session?.headSegment).toBe(1);
    expect(retry.session?.headObjectKey).toBe(first.session?.headObjectKey);
  });

  it('returns conflict for a stale base segment or a caller without the claim', async () => {
    const ctx = newCtx();
    const session = await arrangeClaimedSession(ctx);

    const first = await store.commitSegment({
      session,
      stepAttemptId: ctx.stepAttemptId,
      baseSegment: 0,
      blob: Buffer.from('segment one'),
      manifest: manifest({committedByStepAttempt: ctx.stepAttemptId}),
      headRepoRef: null,
    });
    expect(first.outcome).toBe('committed');

    // Stale base: the head is 1 but the caller commits from 0 again as a new attempt.
    const stale = await store.commitSegment({
      session: requireSession(first),
      stepAttemptId: crypto.randomUUID(),
      baseSegment: 0,
      blob: Buffer.from('zombie writer'),
      manifest: manifest(),
      headRepoRef: null,
    });
    expect(stale.outcome).toBe('conflict');

    // The losing write never touched the object store: the head object is
    // byte-identical and no orphan was left behind.
    const keys = await listSessionObjectKeys(
      `${config.AGENT_SESSION_STORAGE_S3_PREFIX}/${ctx.workspaceId}/${ctx.workflowRunAttemptId}/${session.id}`,
    );
    expect(keys).toEqual([requireSession(first).headObjectKey]);
    const read = await store.readHeadSegment(requireSession(first));
    expect(read?.blob).toEqual(Buffer.from('segment one'));
  });

  it('reads null for a session with no head', async () => {
    const ctx = newCtx();
    const session = await arrangeClaimedSession(ctx);
    expect(await store.readHeadSegment(session)).toBeNull();
  });

  it('fails loudly when the head object is missing', async () => {
    const ctx = newCtx();
    const session = await arrangeClaimedSession(ctx);
    const broken = {
      ...session,
      headSegment: 1,
      headObjectKey: sessionObjectKey(config.AGENT_SESSION_STORAGE_S3_PREFIX, {
        workspaceId: ctx.workspaceId,
        workflowRunAttemptId: ctx.workflowRunAttemptId,
        sessionId: session.id,
        segment: 1,
      }),
      headSizeBytes: 10,
    } as AgentSession;

    await expect(store.readHeadSegment(broken)).rejects.toMatchObject({
      code: 'agent_session_unavailable',
      reason: 'object_missing',
    });
  });

  it('deletes every object under the session prefix plus a carried-over head key', async () => {
    const ctx = newCtx();
    const session = await arrangeClaimedSession(ctx);
    const first = await store.commitSegment({
      session,
      stepAttemptId: ctx.stepAttemptId,
      baseSegment: 0,
      blob: Buffer.from('segment one'),
      manifest: manifest({committedByStepAttempt: ctx.stepAttemptId}),
      headRepoRef: null,
    });
    expect(first.outcome).toBe('committed');
    const second = await store.commitSegment({
      session: requireSession(first),
      stepAttemptId: ctx.stepAttemptId,
      baseSegment: 1,
      blob: Buffer.from('segment two'),
      manifest: manifest({committedByStepAttempt: ctx.stepAttemptId}),
      headRepoRef: null,
    });
    expect(second.outcome).toBe('committed');

    // A carried-over rerun row referencing the source head object under another prefix.
    const carriedHeadKey = sessionObjectKey(config.AGENT_SESSION_STORAGE_S3_PREFIX, {
      workspaceId: ctx.workspaceId,
      workflowRunAttemptId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      segment: 99,
    });
    const carriedSession = {
      ...session,
      headObjectKey: carriedHeadKey,
    } as AgentSession;

    await store.deleteSessionObjects(carriedSession);

    const keys = await listSessionObjectKeys(
      `${config.AGENT_SESSION_STORAGE_S3_PREFIX}/${ctx.workspaceId}/${ctx.workflowRunAttemptId}/${session.id}`,
    );
    expect(keys).toHaveLength(0);
    expect(await objectExists(carriedHeadKey)).toBe(false);
  });
});
