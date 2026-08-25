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
import {eq, inArray} from 'drizzle-orm';
import {config} from '#config.js';
import type {AgentSession} from '#core/entities/agent-session.js';
import {decodeBase64SessionKek} from '#core/session-artifacts/crypto.js';
import {SessionDekManager} from '#core/session-artifacts/dek-manager.js';
import {createSessionKeyProvider} from '#core/session-artifacts/key-provider.js';
import type {SegmentManifest} from '#core/session-artifacts/manifest.js';
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
      await store.commitSegment({
        session,
        stepAttemptId: ctx.stepAttemptId,
        baseSegment: 0,
        blob: Buffer.from('gzipped transcript bytes'),
        manifest: manifest({committedByStepAttempt: ctx.stepAttemptId}),
        headRepoRef: null,
      });
      await db()
        .update(sessions)
        .set({harnessSessionId: 'harness-session-1'})
        .where(eq(sessions.id, session.id));
      await createAppWithWorkflows(workflowsClientFor(ctx, session));
      const token = await mintTestLeaseToken(ctx);

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
      const inject = () =>
        app.inject({
          method: 'POST',
          url: commitUrl(ctx.stepId, 1, 0),
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': SESSION_TRANSCRIPT_CONTENT_TYPE,
            ...manifestHeaders(),
          },
          payload: Buffer.from('gzipped transcript bytes'),
        });

      expect((await inject()).json()).toEqual({status: 'committed', segment: 1});
      const retried = await inject();

      expect(retried.statusCode).toBe(200);
      expect(retried.json()).toEqual({status: 'retry-acked', segment: 1});
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
