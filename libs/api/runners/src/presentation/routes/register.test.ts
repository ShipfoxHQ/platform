import {AUTH_PROVISIONER_TOKEN, AUTH_USER} from '@shipfox/api-auth-context';
import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import type {AuthMethod} from '@shipfox/node-fastify';
import {ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {generateOpaqueToken} from '@shipfox/node-tokens';
import {eq, sql} from 'drizzle-orm';
import type {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify';
import {config} from '#config.js';
import {RunnerLabelsReservedError} from '#core/errors.js';
import {hashRunnersRateLimitIdentifier} from '#core/rate-limit.js';
import {db} from '#db/db.js';
import {revokeManualRegistrationToken} from '#db/manual-registration-tokens.js';
import {ephemeralRegistrationTokens} from '#db/schema/ephemeral-registration-tokens.js';
import {runnersRateLimits} from '#db/schema/rate-limits.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {createRunnerRegistrationTokenAuthMethod} from '#presentation/auth/index.js';
import {
  ephemeralRegistrationTokenFactory,
  fakeLeaseTokenAuthMethod,
  fakeRunnerSessionAuthMethod,
  getRunnerSessionTokenClaims,
  manualRegistrationTokenFactory,
  provisionerTokenFactory,
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
  });

  it('persists a full capability report for a manual runner session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${rawToken}`},
      payload: {labels: ['linux'], capabilities: fullCapabilities},
    });

    expect(res.statusCode).toBe(200);
    const [session] = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, res.json().session_id));
    expect(session?.toolCapabilities).toEqual(fullCapabilities);
    expect(session?.toolCapabilitiesReportedAt).toBeInstanceOf(Date);
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

  it('exchanges an ephemeral registration token for a one-claim runner session', async () => {
    const ephemeralRawToken = generateOpaqueToken('ephemeralRegistrationToken');
    const token = await ephemeralRegistrationTokenFactory.create(
      {workspaceId},
      {transient: {rawToken: ephemeralRawToken}},
    );

    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${ephemeralRawToken}`},
      payload: {labels: ['Linux', 'x64'], capabilities: {harnesses: {pi: {tools: ['read']}}}},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('ephemeral');
    expect(body.max_claims).toBe(1);

    const claims = getRunnerSessionTokenClaims(body.session_token);
    expect(claims?.maxClaims).toBe(1);

    const [session] = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, body.session_id));
    expect(session?.registrationTokenKind).toBe('ephemeral');
    expect(session?.provisionerId).toBe(token.provisionerId);
    expect(session?.providerRunnerId).toBe(token.providerRunnerId);
    expect(session?.maxClaims).toBe(1);
    expect(session?.claimsUsed).toBe(0);
    expect(session?.toolCapabilities).toEqual({harnesses: {pi: {tools: ['read']}}});
    expect(session?.toolCapabilitiesReportedAt).toBeInstanceOf(Date);

    const [consumed] = await db()
      .select()
      .from(ephemeralRegistrationTokens)
      .where(eq(ephemeralRegistrationTokens.id, token.id));
    expect(consumed?.consumedAt).toBeInstanceOf(Date);
    expect(consumed?.consumedSessionId).toBe(body.session_id);
  });

  it('strips reserved labels from ephemeral registration', async () => {
    const ephemeralRawToken = generateOpaqueToken('ephemeralRegistrationToken');
    const provisioner = await provisionerTokenFactory.create({workspaceId});
    const token = await ephemeralRegistrationTokenFactory.create(
      {workspaceId, provisionerId: provisioner.id},
      {transient: {rawToken: ephemeralRawToken}},
    );

    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${ephemeralRawToken}`},
      payload: {labels: ['linux', 'shipfox-managed']},
    });

    const [session] = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, res.json().session_id));

    expect(res.statusCode).toBe(200);
    expect(session).toMatchObject({
      id: res.json().session_id,
      provisionerId: token.provisionerId,
      labels: ['linux'],
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

  it('returns 409 when an ephemeral registration token is reused', async () => {
    const ephemeralRawToken = generateOpaqueToken('ephemeralRegistrationToken');
    await ephemeralRegistrationTokenFactory.create(
      {workspaceId},
      {transient: {rawToken: ephemeralRawToken}},
    );
    const request = {
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${ephemeralRawToken}`},
      payload: {labels: ['linux']},
    } as const;

    const first = await app.inject(request);
    const second = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('registration-token-consumed');
  });

  it('returns 429 when the ephemeral registration rate limit is exceeded', async () => {
    const ephemeralRawToken = generateOpaqueToken('ephemeralRegistrationToken');
    const token = await ephemeralRegistrationTokenFactory.create(
      {workspaceId},
      {transient: {rawToken: ephemeralRawToken}},
    );
    await seedEphemeralRegisterRateLimit(
      token.id,
      config.EPHEMERAL_REGISTER_RATE_LIMIT_MAX_REQUESTS,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${ephemeralRawToken}`},
      payload: {labels: ['linux']},
    });

    const [persistedToken] = await db()
      .select()
      .from(ephemeralRegistrationTokens)
      .where(eq(ephemeralRegistrationTokens.id, token.id));
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toEqual(expect.any(String));
    expect(res.json()).toMatchObject({
      code: 'rate-limited',
      details: {retry_after_seconds: expect.any(Number)},
    });
    expect(persistedToken?.consumedAt).toBeNull();
  });

  it('returns 503 when the ephemeral registration rate limiter is unavailable', async () => {
    const ephemeralRawToken = generateOpaqueToken('ephemeralRegistrationToken');
    const token = await ephemeralRegistrationTokenFactory.create(
      {workspaceId},
      {transient: {rawToken: ephemeralRawToken}},
    );
    const identifierHmac = await seedEphemeralRegisterRateLimit(token.id, 1);

    await db().transaction(async (tx) => {
      await tx.execute(sql`
        SELECT 1
        FROM runners_rate_limits
        WHERE identifier_hmac = ${identifierHmac}
        FOR UPDATE
      `);

      const res = await app.inject({
        method: 'POST',
        url: '/runners/register',
        headers: {authorization: `Bearer ${ephemeralRawToken}`},
        payload: {labels: ['linux']},
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('runners-rate-limit-unavailable');
    });

    const [persistedToken] = await db()
      .select()
      .from(ephemeralRegistrationTokens)
      .where(eq(ephemeralRegistrationTokens.id, token.id));
    expect(persistedToken?.consumedAt).toBeNull();
  });

  it('does not apply the ephemeral registration rate limit to manual registration', async () => {
    const statusCodes: number[] = [];

    for (let index = 0; index <= config.EPHEMERAL_REGISTER_RATE_LIMIT_MAX_REQUESTS; index += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/runners/register',
        headers: {authorization: `Bearer ${rawToken}`},
        payload: {labels: [`linux-${index}`]},
      });
      statusCodes.push(res.statusCode);
    }

    expect(statusCodes).toEqual(
      Array.from({length: config.EPHEMERAL_REGISTER_RATE_LIMIT_MAX_REQUESTS + 1}, () => 200),
    );
  });

  it('returns 401 when an ephemeral registration token is expired', async () => {
    const ephemeralRawToken = generateOpaqueToken('ephemeralRegistrationToken');
    await ephemeralRegistrationTokenFactory.create(
      {workspaceId, expiresAt: new Date(Date.now() - 1000)},
      {transient: {rawToken: ephemeralRawToken}},
    );

    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${ephemeralRawToken}`},
      payload: {labels: ['linux']},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('registration-token-expired');
  });

  it('returns 401 when an ephemeral registration token is not found', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${generateOpaqueToken('ephemeralRegistrationToken')}`},
      payload: {labels: ['linux']},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
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

  async function seedEphemeralRegisterRateLimit(
    tokenId: string,
    seedCount: number,
  ): Promise<string> {
    const identifierHmac = hashRunnersRateLimitIdentifier({
      action: 'ephemeral-register',
      scope: 'ephemeral-token',
      identifier: tokenId,
    });
    const windows = rateLimitWindows(config.EPHEMERAL_REGISTER_RATE_LIMIT_WINDOW_SECONDS);

    await db()
      .insert(runnersRateLimits)
      .values(
        windows.map((windowStart) => ({
          action: 'ephemeral-register',
          scope: 'ephemeral-token',
          identifierHmac,
          windowStart,
          count: seedCount,
          expiresAt: new Date(
            windowStart.getTime() + config.EPHEMERAL_REGISTER_RATE_LIMIT_WINDOW_SECONDS * 1000,
          ),
        })),
      );

    return identifierHmac;
  }

  function rateLimitWindows(windowSeconds: number): [Date, Date] {
    const windowMs = windowSeconds * 1000;
    const currentWindowStart = Math.floor(Date.now() / windowMs) * windowMs;
    return [new Date(currentWindowStart), new Date(currentWindowStart + windowMs)];
  }
});
