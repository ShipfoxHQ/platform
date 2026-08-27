import {AUTH_PROVISIONER_TOKEN, AUTH_USER} from '@shipfox/api-auth-context';
import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import type {AuthMethod} from '@shipfox/node-fastify';
import {ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {generateOpaqueToken} from '@shipfox/node-tokens';
import {eq} from 'drizzle-orm';
import type {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify';
import {RunnerLabelsReservedError} from '#core/errors.js';
import {db} from '#db/db.js';
import {revokeManualRegistrationToken} from '#db/manual-registration-tokens.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {createRunnerRegistrationTokenAuthMethod} from '#presentation/auth/index.js';
import {
  fakeLeaseTokenAuthMethod,
  fakeRunnerSessionAuthMethod,
  getRunnerSessionTokenClaims,
  manualRegistrationTokenFactory,
  runnersTestAuthClient,
} from '#test/index.js';
import {createRunnerRoutes} from './index.js';
import {createRegisterRoute} from './register.js';

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: () => Promise.resolve(),
};

const fakeProvisionerAuth: AuthMethod = {
  name: AUTH_PROVISIONER_TOKEN,
  authenticate: () => Promise.resolve(),
};

const fullCapabilities: RunnerToolCapabilitiesDto = {
  features: {renewable_git: true},
  harnesses: {
    pi: {tools: ['read', 'bash', 'web_search']},
    claude: {tools: ['Read', 'Bash', 'WebSearch']},
  },
};

describe('POST /runners/register', () => {
  let app: FastifyInstance;
  let rawToken: string;
  let workspaceId: string;

  beforeAll(async () => {
    app = await createApp({
      auth: [
        fakeUserAuth,
        createRunnerRegistrationTokenAuthMethod(),
        fakeRunnerSessionAuthMethod,
        fakeLeaseTokenAuthMethod,
        fakeProvisionerAuth,
      ],
      routes: createRunnerRoutes(runnersTestAuthClient),
      swagger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    rawToken = generateOpaqueToken('manualRegistrationToken');
    workspaceId = crypto.randomUUID();
    await manualRegistrationTokenFactory.create({workspaceId}, {transient: {rawToken}});
  });

  it('exchanges a registration token for a manual runner session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${rawToken}`},
      payload: {labels: ['Linux', 'x64', 'linux']},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.session_token).toBe('string');
    expect(body.session_id).toEqual(expect.any(String));
    expect(body.mode).toBe('manual');
    expect(body.max_claims).toBeNull();

    const claims = getRunnerSessionTokenClaims(body.session_token);
    expect(claims).toMatchObject({
      runnerSessionId: body.session_id,
      workspaceId,
      scope: 'workspace',
      labels: ['linux', 'x64'],
      maxClaims: null,
    });

    const rows = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, body.session_id));
    expect(rows[0]?.labels).toEqual(['linux', 'x64']);
    expect(rows[0]?.registrationTokenKind).toBe('manual');
    expect(rows[0]?.provisionerId).toBeNull();
    expect(rows[0]?.providerRunnerId).toBeNull();
    expect(rows[0]?.toolCapabilities).toBeNull();
    expect(rows[0]?.toolCapabilitiesReportedAt).toBeNull();
    expect(rows[0]?.lifecycleCapabilities).toBeNull();
    expect(rows[0]?.lifecycleCapabilitiesReportedAt).toBeNull();
  });

  it('persists a full capability report for a manual runner session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${rawToken}`},
      payload: {
        labels: ['linux'],
        capabilities: fullCapabilities,
        lifecycle_capabilities: ['local_execution_fence_v1'],
      },
    });

    expect(res.statusCode).toBe(200);
    const [session] = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, res.json().session_id));
    expect(session?.toolCapabilities).toEqual(fullCapabilities);
    expect(session?.toolCapabilitiesReportedAt).toBeInstanceOf(Date);
    expect(session?.lifecycleCapabilities).toEqual(['local_execution_fence_v1']);
    expect(session?.lifecycleCapabilitiesReportedAt).toBeInstanceOf(Date);
  });

  it('strips reserved labels from manual registration', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${rawToken}`},
      payload: {labels: ['linux', 'shipfox-managed', 'x64']},
    });

    const [session] = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, res.json().session_id));

    expect(res.statusCode).toBe(200);
    expect(session?.labels).toEqual(['linux', 'x64']);
  });

  it('returns a distinct error when all manual registration labels are reserved', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${rawToken}`},
      payload: {labels: ['shipfox-managed']},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'runner-labels-reserved',
      details: {labels: ['shipfox-managed']},
    });
  });

  it('rejects malformed capability reports without creating a runner session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${rawToken}`},
      payload: {labels: ['linux'], capabilities: {harnesses: {pi: {tools: ['read', 'read']}}}},
    });

    expect(res.statusCode).toBe(400);
    const rows = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.workspaceId, workspaceId));
    expect(rows).toHaveLength(0);
  });

  it('creates independent sessions from the same registration token', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${rawToken}`},
      payload: {labels: ['linux']},
    });
    const second = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${rawToken}`},
      payload: {labels: ['macos']},
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().session_id).not.toBe(second.json().session_id);

    const rows = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.workspaceId, workspaceId));
    expect(rows.map((row) => row.labels).sort()).toEqual([['linux'], ['macos']]);
  });

  it('returns 401 when the registration token is expired', async () => {
    const expiredRawToken = generateOpaqueToken('manualRegistrationToken');
    await manualRegistrationTokenFactory.create(
      {workspaceId, expiresAt: new Date(Date.now() - 1000)},
      {transient: {rawToken: expiredRawToken}},
    );

    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${expiredRawToken}`},
      payload: {labels: ['linux']},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('registration-token-expired');
  });

  it('returns a stable unauthorized response for legacy ephemeral tokens', async () => {
    const request = {
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${generateOpaqueToken('ephemeralRegistrationToken')}`},
      payload: {labels: ['linux']},
    } as const;

    const first = await app.inject(request);
    const second = await app.inject(request);

    expect(first.statusCode).toBe(401);
    expect(first.json()).toMatchObject({code: 'unauthorized'});
    expect(second.statusCode).toBe(401);
    expect(second.json()).toMatchObject({code: 'unauthorized'});
  });

  it('returns 401 when the registration token is revoked', async () => {
    const revokedRawToken = generateOpaqueToken('manualRegistrationToken');
    const token = await manualRegistrationTokenFactory.create(
      {workspaceId},
      {transient: {rawToken: revokedRawToken}},
    );
    await revokeManualRegistrationToken({tokenId: token.id, workspaceId});

    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${revokedRawToken}`},
      payload: {labels: ['linux']},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('manual-registration-token-revoked');
  });

  it('returns 401 when the registration token prefix is unknown', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: 'Bearer sf_unknown_token'},
      payload: {labels: ['linux']},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
  });

  it.each([
    ['too many labels', {labels: Array.from({length: 21}, (_, index) => `label-${index}`)}],
    ['too long label', {labels: ['a'.repeat(129)]}],
    ['bad charset', {labels: ['linux/amd64']}],
  ])('returns 400 for %s', async (_case, payload) => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${rawToken}`},
      payload,
    });

    expect(res.statusCode).toBe(400);
  });

  it.each([
    ['20 labels', {labels: Array.from({length: 20}, (_, index) => `label-${index}`)}],
    ['128-character label', {labels: ['a'.repeat(128)]}],
  ])('accepts %s', async (_case, payload) => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${rawToken}`},
      payload,
    });

    expect(res.statusCode).toBe(200);
  });

  it('maps reserved-label-only registration failures to a public error code', () => {
    const route = createRegisterRoute(runnersTestAuthClient);

    try {
      route.errorHandler?.(
        new RunnerLabelsReservedError(['shipfox-managed']),
        {} as FastifyRequest,
        {} as FastifyReply,
      );
      throw new Error('Expected register route error handler to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ClientError);
      expect(error).toMatchObject({
        code: 'runner-labels-reserved',
        details: {labels: ['shipfox-managed']},
        status: 400,
      });
    }
  });
});
