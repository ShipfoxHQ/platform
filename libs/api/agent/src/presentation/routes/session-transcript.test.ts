import crypto from 'node:crypto';
import {
  SESSION_TRANSCRIPT_CONTENT_TYPE,
  SESSION_TRANSCRIPT_HARNESS_HEADER,
  SESSION_TRANSCRIPT_HARNESS_SESSION_ID_HEADER,
  SESSION_TRANSCRIPT_MODEL_HEADER,
  SESSION_TRANSCRIPT_PROVIDER_HEADER,
  SESSION_TRANSCRIPT_SDK_VERSION_HEADER,
  SESSION_TRANSCRIPT_SEGMENT_HEADER,
} from '@shipfox/api-agent-dto';
import {AUTH_USER} from '@shipfox/api-auth-context';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {type AuthMethod, closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {inArray} from 'drizzle-orm';
import {config} from '#config.js';
import type {AgentSession} from '#core/entities/agent-session.js';
import {AgentSessionUnavailableError} from '#core/errors.js';
import {decodeBase64SessionKek} from '#core/session-artifacts/crypto.js';
import {SessionDekManager} from '#core/session-artifacts/dek-manager.js';
import {createSessionKeyProvider} from '#core/session-artifacts/key-provider.js';
import * as objectStorage from '#core/session-artifacts/object-storage.js';
import {
  deleteSessionObjects,
  listSessionObjectKeys,
} from '#core/session-artifacts/object-storage.js';
import {
  createSessionArtifactStore,
  type SessionArtifactStore,
} from '#core/session-artifacts/store.js';
import {
  claimSession,
  createSession,
  db,
  getSessionById,
  sessionDataKeys,
  sessions,
} from '#db/index.js';
import {
  fakeLeaseTokenAuthMethod,
  type MintLeaseTokenParams,
  mintLeaseToken,
} from '#test/fixtures/lease-token.js';
import {createTestWorkflowsClient} from '#test/fixtures/workflows-client.js';
import {createAgentRoutes} from './index.js';

// The agent route set also carries session-authed groups; register a no-op
// AUTH_USER method so auth-reference validation passes (these tests only
// exercise the lease-authed session transcript group).
const stubUserAuth: AuthMethod = {name: AUTH_USER, authenticate: () => Promise.resolve()};

const JOB_EXECUTION_ID = '00000000-0000-4000-8000-0000000000ee';

function sessionUrl(stepId: string, attempt: number): string {
  return `/runs/jobs/current/steps/${stepId}/session?attempt=${attempt}`;
}

function commitUrl(stepId: string, attempt: number, baseSegment: number): string {
  return `${sessionUrl(stepId, attempt)}&base_segment=${baseSegment}`;
}

function manifestHeaders(): Record<string, string> {
  return {
    [SESSION_TRANSCRIPT_SDK_VERSION_HEADER]: '0.82.0',
    [SESSION_TRANSCRIPT_MODEL_HEADER]: 'gpt-5.2',
    [SESSION_TRANSCRIPT_PROVIDER_HEADER]: 'openai',
  };
}

function commitHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': SESSION_TRANSCRIPT_CONTENT_TYPE,
    ...manifestHeaders(),
    ...extra,
  };
}

describe('lease-authed session transcript routes', () => {
  let app: FastifyInstance;
  let store: SessionArtifactStore;
  const workspaceIds = new Set<string>();

  function newCtx(overrides: Partial<SessionCtx> = {}): SessionCtx {
    const ctx = {
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      key: 'main',
      stepAttemptId: crypto.randomUUID(),
      stepId: crypto.randomUUID(),
      ...overrides,
    };
    workspaceIds.add(ctx.workspaceId);
    return ctx;
  }

  interface SessionCtx {
    workspaceId: string;
    projectId: string;
    workflowRunAttemptId: string;
    key: string;
    stepAttemptId: string;
    stepId: string;
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

  async function cleanupArtifacts(): Promise<void> {
    for (const workspaceId of workspaceIds) {
      const keys = await listSessionObjectKeys(
        `${config.AGENT_SESSION_STORAGE_S3_PREFIX}/${workspaceId}`,
      );
      if (keys.length > 0) await deleteSessionObjects(keys);
    }
  }

  async function cleanupDatabase(): Promise<void> {
    const ids = [...workspaceIds];
    if (ids.length === 0) return;
    await db().delete(sessions).where(inArray(sessions.workspaceId, ids));
    await db().delete(sessionDataKeys).where(inArray(sessionDataKeys.workspaceId, ids));
  }

  function mintTestLeaseToken(
    ctx: SessionCtx,
    overrides: Partial<MintLeaseTokenParams> = {},
  ): Promise<string> {
    return mintLeaseToken({
      jobId: crypto.randomUUID(),
      jobExecutionId: JOB_EXECUTION_ID,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      workflowRunAttemptId: ctx.workflowRunAttemptId,
      currentStepId: ctx.stepId,
      currentStepAttempt: 1,
      ...overrides,
    });
  }

  function workflowsClientFor(ctx: SessionCtx, session: AgentSession | null) {
    return createTestWorkflowsClient({
      getLeasedAgentSessionContext: () =>
        Promise.resolve({
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          workflowRunAttemptId: ctx.workflowRunAttemptId,
          stepAttemptId: ctx.stepAttemptId,
          session:
            session === null
              ? null
              : {id: session.id, key: session.key, mode: 'resume', segment: session.headSegment},
        }),
    });
  }

  beforeEach(async () => {
    await closeApp();
    store = createSessionArtifactStore({
      dekManager: new SessionDekManager(
        createSessionKeyProvider(
          decodeBase64SessionKek(
            config.AGENT_SESSION_ENCRYPTION_KEK,
            'AGENT_SESSION_ENCRYPTION_KEK',
          ),
        ),
        {maxEntries: 32, ttlMs: 60_000},
      ),
    });
  });

  afterEach(async () => {
    await closeApp();
    await cleanupArtifacts();
    await cleanupDatabase();
    workspaceIds.clear();
  });

  async function createAppWithWorkflows(
    workflows: ReturnType<typeof createTestWorkflowsClient>,
  ): Promise<void> {
    app = await createApp({
      auth: [fakeLeaseTokenAuthMethod, stubUserAuth],
      routes: createAgentRoutes(undefined as never, {
        workflows,
        sessionArtifactStore: store,
      }),
      swagger: false,
    });
    await app.ready();
  }

  describe('GET /runs/jobs/current/steps/:stepId/session', () => {
    it('rejects a request without a lease token', async () => {
      const ctx = newCtx();
      await createAppWithWorkflows(workflowsClientFor(ctx, null));

      const res = await app.inject({method: 'GET', url: sessionUrl(ctx.stepId, 1)});

      expect(res.statusCode).toBe(401);
    });

    it('returns the decrypted, still-gzipped head snapshot with manifest headers', async () => {
      const ctx = newCtx();
      const session = await arrangeClaimedSession(ctx);
      await createAppWithWorkflows(workflowsClientFor(ctx, session));
      const token = await mintTestLeaseToken(ctx);

      // End-to-end harness-session-id round trip: the runner reports the
      // harness-native session id on the commit, the server persists it on the
      // row when the head flips, and the GET serves it back.
      const commit = await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 0),
        headers: {
          authorization: `Bearer ${token}`,
          ...commitHeaders({[SESSION_TRANSCRIPT_HARNESS_SESSION_ID_HEADER]: 'harness-session-1'}),
        },
        payload: Buffer.from('gzipped transcript bytes'),
      });
      expect(commit.statusCode).toBe(200);

      const res = await app.inject({
        method: 'GET',
        url: sessionUrl(ctx.stepId, 1),
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain(SESSION_TRANSCRIPT_CONTENT_TYPE);
      expect(res.rawPayload).toEqual(Buffer.from('gzipped transcript bytes'));
      expect(res.headers[SESSION_TRANSCRIPT_SEGMENT_HEADER]).toBe('1');
      expect(res.headers[SESSION_TRANSCRIPT_HARNESS_HEADER]).toBe('pi');
      expect(res.headers[SESSION_TRANSCRIPT_HARNESS_SESSION_ID_HEADER]).toBe('harness-session-1');
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('returns a 204 no-head marker for a fresh session', async () => {
      const ctx = newCtx();
      const session = await arrangeClaimedSession(ctx);
      await createAppWithWorkflows(workflowsClientFor(ctx, session));
      const token = await mintTestLeaseToken(ctx);

      const res = await app.inject({
        method: 'GET',
        url: sessionUrl(ctx.stepId, 1),
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(204);
      expect(res.headers[SESSION_TRANSCRIPT_SEGMENT_HEADER]).toBe('0');
    });

    it('rejects a step outside the leased execution scope', async () => {
      const ctx = newCtx();
      await createAppWithWorkflows(workflowsClientFor(ctx, null));
      const token = await mintTestLeaseToken(ctx, {currentStepId: crypto.randomUUID()});

      const res = await app.inject({
        method: 'GET',
        url: sessionUrl(ctx.stepId, 1),
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('step-not-found');
    });

    it('rejects a step whose attempt does not match the leased scope', async () => {
      const ctx = newCtx();
      await createAppWithWorkflows(workflowsClientFor(ctx, null));
      const token = await mintTestLeaseToken(ctx, {currentStepAttempt: 1});

      const res = await app.inject({
        method: 'GET',
        url: sessionUrl(ctx.stepId, 2),
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('step-not-found');
    });

    it('rejects a step with no recorded session', async () => {
      const ctx = newCtx();
      await createAppWithWorkflows(workflowsClientFor(ctx, null));
      const token = await mintTestLeaseToken(ctx);

      const res = await app.inject({
        method: 'GET',
        url: sessionUrl(ctx.stepId, 1),
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('session-not-found');
    });

    it('rejects a recorded descriptor whose row is missing', async () => {
      const ctx = newCtx();
      // Descriptor names a session row that does not exist.
      const workflows = createTestWorkflowsClient({
        getLeasedAgentSessionContext: () =>
          Promise.resolve({
            workspaceId: ctx.workspaceId,
            projectId: ctx.projectId,
            workflowRunAttemptId: ctx.workflowRunAttemptId,
            stepAttemptId: ctx.stepAttemptId,
            session: {
              id: crypto.randomUUID(),
              key: ctx.key,
              mode: 'resume',
              segment: 0,
            },
          }),
      });
      await createAppWithWorkflows(workflows);
      const token = await mintTestLeaseToken(ctx);

      const res = await app.inject({
        method: 'GET',
        url: sessionUrl(ctx.stepId, 1),
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('session-not-found');
    });

    it('maps a dead lease to 404 lease-not-active', async () => {
      const ctx = newCtx();
      const workflows = createTestWorkflowsClient({
        getLeasedAgentSessionContext: () =>
          Promise.reject(
            createInterModuleKnownError(
              workflowsInterModuleContract.methods.getLeasedAgentSessionContext,
              'lease-not-active',
              {},
            ),
          ),
      });
      await createAppWithWorkflows(workflows);
      const token = await mintTestLeaseToken(ctx);

      const res = await app.inject({
        method: 'GET',
        url: sessionUrl(ctx.stepId, 1),
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('lease-not-active');
    });

    test.each([
      ['step-not-found', 404],
      ['job-not-found', 404],
      ['step-attempt-mismatch', 409],
      ['step-not-running', 409],
      ['leased-step-not-agent', 409],
      ['step-session-config-invalid', 409],
    ] as const)('maps a workflows %s known error to %i', async (code, status) => {
      const ctx = newCtx();
      const workflows = createTestWorkflowsClient({
        getLeasedAgentSessionContext: () =>
          Promise.reject(
            createInterModuleKnownError(
              workflowsInterModuleContract.methods.getLeasedAgentSessionContext,
              code,
              {},
            ),
          ),
      });
      await createAppWithWorkflows(workflows);
      const token = await mintTestLeaseToken(ctx);

      const res = await app.inject({
        method: 'GET',
        url: sessionUrl(ctx.stepId, 1),
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(status);
      expect(res.json().code).toBe(code);
    });

    it('maps a missing head object to 503 session-unavailable with the reason', async () => {
      const ctx = newCtx();
      const session = await arrangeClaimedSession(ctx);
      await createAppWithWorkflows(workflowsClientFor(ctx, session));
      // The row points at a head that no longer exists in the object store:
      // the store raises object_missing, which must surface as the stable
      // session-unavailable contract instead of a 500.
      vi.spyOn(store, 'readHeadSegment').mockRejectedValue(
        new AgentSessionUnavailableError('object_missing'),
      );
      const token = await mintTestLeaseToken(ctx);

      const res = await app.inject({
        method: 'GET',
        url: sessionUrl(ctx.stepId, 1),
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({
        code: 'session-unavailable',
        details: {reason: 'object_missing'},
      });
    });

    it('rejects a descriptor naming a session row of another workspace', async () => {
      const ctxA = newCtx();
      const other = newCtx();
      // A real session row in workspace B.
      const foreignSession = await arrangeClaimedSession(other);
      // The lease resolves to workspace A but returns B's session id: a
      // forwarded descriptor must not reach another tenant's session.
      const workflows = createTestWorkflowsClient({
        getLeasedAgentSessionContext: () =>
          Promise.resolve({
            workspaceId: ctxA.workspaceId,
            projectId: ctxA.projectId,
            workflowRunAttemptId: ctxA.workflowRunAttemptId,
            stepAttemptId: ctxA.stepAttemptId,
            session: {
              id: foreignSession.id,
              key: other.key,
              mode: 'resume',
              segment: 0,
            },
          }),
      });
      await createAppWithWorkflows(workflows);
      // The store must never be touched: resolution fails before any object
      // access under the foreign workspace's prefix.
      const readSpy = vi.spyOn(store, 'readHeadSegment');
      const token = await mintTestLeaseToken(ctxA);

      const res = await app.inject({
        method: 'GET',
        url: sessionUrl(ctxA.stepId, 1),
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('session-not-found');
      expect(readSpy).not.toHaveBeenCalled();
    });
  });

  describe('POST /runs/jobs/current/steps/:stepId/session', () => {
    it('commits a segment when the caller holds the claim and the base equals the head', async () => {
      const ctx = newCtx();
      const session = await arrangeClaimedSession(ctx);
      await createAppWithWorkflows(workflowsClientFor(ctx, session));
      const token = await mintTestLeaseToken(ctx);

      const res = await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 0),
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': SESSION_TRANSCRIPT_CONTENT_TYPE,
          ...manifestHeaders(),
        },
        payload: Buffer.from('gzipped transcript bytes'),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({status: 'committed', segment: 1});

      // The head pointer advanced on the row; re-read it to serve the GET.
      const committed = await getSessionById(session.id);
      expect(committed).not.toBeNull();
      const head = committed ? await store.readHeadSegment(committed) : null;
      expect(head?.blob).toEqual(Buffer.from('gzipped transcript bytes'));
    });

    it('acks a retried commit without rewriting', async () => {
      const ctx = newCtx();
      const session = await arrangeClaimedSession(ctx);
      await createAppWithWorkflows(workflowsClientFor(ctx, session));
      const token = await mintTestLeaseToken(ctx);

      const first = await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 0),
        headers: {authorization: `Bearer ${token}`, ...commitHeaders()},
        payload: Buffer.from('gzipped transcript bytes'),
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({status: 'committed', segment: 1});

      // The retry carries a distinct payload; if the retry path re-sealed or
      // re-uploaded the object (or re-flipped the head to a new key) while
      // still acking, the follow-up GET would expose the rewritten bytes or a
      // moved segment header.
      const retried = await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 0),
        headers: {authorization: `Bearer ${token}`, ...commitHeaders()},
        payload: Buffer.from('distinct retry payload that must not land'),
      });

      expect(retried.statusCode).toBe(200);
      expect(retried.json()).toEqual({status: 'retry-acked', segment: 1});

      const head = await app.inject({
        method: 'GET',
        url: sessionUrl(ctx.stepId, 1),
        headers: {authorization: `Bearer ${token}`},
      });
      expect(head.statusCode).toBe(200);
      expect(head.rawPayload).toEqual(Buffer.from('gzipped transcript bytes'));
      expect(head.headers[SESSION_TRANSCRIPT_SEGMENT_HEADER]).toBe('1');
    });

    it('serializes concurrent duplicate commits: one committed, one retry-acked, one upload', async () => {
      const ctx = newCtx();
      const session = await arrangeClaimedSession(ctx);
      await createAppWithWorkflows(workflowsClientFor(ctx, session));
      const token = await mintTestLeaseToken(ctx);
      const putSpy = vi.spyOn(objectStorage, 'putSessionObject');

      const inject = () =>
        app.inject({
          method: 'POST',
          url: commitUrl(ctx.stepId, 1, 0),
          headers: {authorization: `Bearer ${token}`, ...commitHeaders()},
          payload: Buffer.from('gzipped transcript bytes'),
        });

      const [a, b] = await Promise.all([inject(), inject()]);

      const outcomes = [a.json(), b.json()].map((r) => r.status);
      expect(outcomes.sort()).toEqual(['committed', 'retry-acked']);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      // The row lock serializes the duplicates: the winner uploads exactly
      // once and flips the head; the loser is acked without touching the
      // object store.
      expect(putSpy).toHaveBeenCalledTimes(1);

      const committed = await getSessionById(session.id);
      expect(committed).not.toBeNull();
      const head = committed ? await store.readHeadSegment(committed) : null;
      expect(head?.blob).toEqual(Buffer.from('gzipped transcript bytes'));
    });

    it('commits a second forward segment (base 1 -> 2) and flips the head', async () => {
      const ctx = newCtx();
      const session = await arrangeClaimedSession(ctx);
      await createAppWithWorkflows(workflowsClientFor(ctx, session));
      const token = await mintTestLeaseToken(ctx);

      const first = await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 0),
        headers: {authorization: `Bearer ${token}`, ...commitHeaders()},
        payload: Buffer.from('first segment bytes'),
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({status: 'committed', segment: 1});

      const second = await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 1),
        headers: {authorization: `Bearer ${token}`, ...commitHeaders()},
        payload: Buffer.from('second segment bytes'),
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({status: 'committed', segment: 2});

      // GET serves segment 2 with the second blob.
      const head = await app.inject({
        method: 'GET',
        url: sessionUrl(ctx.stepId, 1),
        headers: {authorization: `Bearer ${token}`},
      });
      expect(head.statusCode).toBe(200);
      expect(head.rawPayload).toEqual(Buffer.from('second segment bytes'));
      expect(head.headers[SESSION_TRANSCRIPT_SEGMENT_HEADER]).toBe('2');

      // A stale base (0) against head 2 conflicts with the current head.
      const stale = await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 0),
        headers: {authorization: `Bearer ${token}`, ...commitHeaders()},
        payload: Buffer.from('stale commit'),
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toEqual({
        code: 'session-commit-conflict',
        details: {head_segment: 2},
      });
    });

    it('persists the reported harness session id on the row when the head flips', async () => {
      const ctx = newCtx();
      const session = await arrangeClaimedSession(ctx);
      await createAppWithWorkflows(workflowsClientFor(ctx, session));
      const token = await mintTestLeaseToken(ctx);

      const res = await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 0),
        headers: {
          authorization: `Bearer ${token}`,
          ...commitHeaders({[SESSION_TRANSCRIPT_HARNESS_SESSION_ID_HEADER]: 'harness-session-9'}),
        },
        payload: Buffer.from('gzipped transcript bytes'),
      });

      expect(res.statusCode).toBe(200);
      const committed = await getSessionById(session.id);
      expect(committed?.harnessSessionId).toBe('harness-session-9');
    });

    it('rejects an absent commit body with 400', async () => {
      const ctx = newCtx();
      const session = await arrangeClaimedSession(ctx);
      await createAppWithWorkflows(workflowsClientFor(ctx, session));
      const token = await mintTestLeaseToken(ctx);

      // No Content-Type and no body: the raw-body plugin never parses it, so
      // the handler sees no body.
      const noBody = await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 0),
        headers: {authorization: `Bearer ${token}`, ...manifestHeaders()},
      });

      expect(noBody.statusCode).toBe(400);
      expect(noBody.json().code).toBe('empty-session-transcript');

      // A zero-length body with the session content type parses to an empty
      // Buffer; a gzipped harness session file is never zero bytes.
      const emptyBody = await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 0),
        headers: {authorization: `Bearer ${token}`, ...commitHeaders()},
        payload: Buffer.alloc(0),
      });

      expect(emptyBody.statusCode).toBe(400);
      expect(emptyBody.json().code).toBe('empty-session-transcript');
    });

    it('returns 409 on a stale base segment', async () => {
      const ctx = newCtx();
      const session = await arrangeClaimedSession(ctx);
      await createAppWithWorkflows(workflowsClientFor(ctx, session));
      const token = await mintTestLeaseToken(ctx);
      await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 0),
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': SESSION_TRANSCRIPT_CONTENT_TYPE,
          ...manifestHeaders(),
        },
        payload: Buffer.from('first commit'),
      });

      // The head is now segment 1; a commit on base 2 can never land (the
      // segment CAS only accepts base == head), so this is a stale base.
      const stale = await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 2),
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': SESSION_TRANSCRIPT_CONTENT_TYPE,
          ...manifestHeaders(),
        },
        payload: Buffer.from('stale commit'),
      });

      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toEqual({
        code: 'session-commit-conflict',
        details: {head_segment: 1},
      });
    });

    it('returns 409 when the caller does not hold the claim', async () => {
      const ctx = newCtx();
      const session = await arrangeClaimedSession(ctx);
      // The lease resolves to a different step attempt than the one holding
      // the claim (a zombie writer whose claim was superseded).
      const workflows = createTestWorkflowsClient({
        getLeasedAgentSessionContext: () =>
          Promise.resolve({
            workspaceId: ctx.workspaceId,
            projectId: ctx.projectId,
            workflowRunAttemptId: ctx.workflowRunAttemptId,
            stepAttemptId: crypto.randomUUID(),
            session: {
              id: session.id,
              key: session.key,
              mode: 'resume',
              segment: session.headSegment,
            },
          }),
      });
      await createAppWithWorkflows(workflows);
      const token = await mintTestLeaseToken(ctx);

      const res = await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 0),
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': SESSION_TRANSCRIPT_CONTENT_TYPE,
          ...manifestHeaders(),
        },
        payload: Buffer.from('zombie commit'),
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('session-commit-conflict');
    });

    it('rejects a blob over the platform cap with 413', async () => {
      const ctx = newCtx();
      const session = await arrangeClaimedSession(ctx);
      await createAppWithWorkflows(workflowsClientFor(ctx, session));
      const token = await mintTestLeaseToken(ctx);

      const res = await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 0),
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': SESSION_TRANSCRIPT_CONTENT_TYPE,
          ...manifestHeaders(),
        },
        payload: Buffer.alloc(config.AGENT_SESSION_BLOB_CAP_BYTES + 1),
      });

      expect(res.statusCode).toBe(413);
      expect(res.json().code).toBe('blob-cap-exceeded');
    });

    it('commits a blob exactly at the platform cap', async () => {
      const ctx = newCtx();
      const session = await arrangeClaimedSession(ctx);
      await createAppWithWorkflows(workflowsClientFor(ctx, session));
      const token = await mintTestLeaseToken(ctx);

      const res = await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 0),
        headers: {authorization: `Bearer ${token}`, ...commitHeaders()},
        payload: Buffer.alloc(config.AGENT_SESSION_BLOB_CAP_BYTES),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({status: 'committed', segment: 1});
    });

    it('rejects a blob over the raw-body limit with the same blob-cap-exceeded contract', async () => {
      const ctx = newCtx();
      const session = await arrangeClaimedSession(ctx);
      await createAppWithWorkflows(workflowsClientFor(ctx, session));
      const token = await mintTestLeaseToken(ctx);

      // The parser limit sits one MiB above the cap as a memory guard; a blob
      // beyond it is rejected by Fastify before the handler runs and must
      // surface under the same contract as the store's precise cap check.
      const overLimit = Buffer.alloc(config.AGENT_SESSION_BLOB_CAP_BYTES + 1024 * 1024 + 1);
      const res = await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 0),
        headers: {authorization: `Bearer ${token}`, ...commitHeaders()},
        payload: overLimit,
      });

      expect(res.statusCode).toBe(413);
      expect(res.json()).toEqual({
        code: 'blob-cap-exceeded',
        details: {max_bytes: config.AGENT_SESSION_BLOB_CAP_BYTES},
      });
    });

    it('rejects a commit without the manifest headers', async () => {
      const ctx = newCtx();
      const session = await arrangeClaimedSession(ctx);
      await createAppWithWorkflows(workflowsClientFor(ctx, session));
      const token = await mintTestLeaseToken(ctx);

      const res = await app.inject({
        method: 'POST',
        url: commitUrl(ctx.stepId, 1, 0),
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': SESSION_TRANSCRIPT_CONTENT_TYPE,
        },
        payload: Buffer.from('gzipped transcript bytes'),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('missing-manifest-header');
    });
  });
});
