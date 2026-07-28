import {
  AUTH_LEASED_JOB,
  AUTH_PROVISIONER_TOKEN,
  AUTH_RUNNER_REGISTRATION_TOKEN,
  AUTH_RUNNER_SESSION,
  AUTH_USER,
  buildUserContext,
  setUserContext,
} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {vi} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {provisionerTokens} from '#db/schema/provisioner-tokens.js';
import {runnerControlSessions} from '#db/schema/runner-control-sessions.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {provisionerTokenFactory, runnerSessionFactory, runnersTestAuthClient} from '#test/index.js';
import {createRunnerRoutes} from './index.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    setUserContext(
      request,
      buildUserContext({
        userId: USER_ID,
        email: 'admin@example.com',
        name: 'Administrator',
        memberships: [],
      }),
    );
    return Promise.resolve();
  },
};

const passthroughAuth = (name: string): AuthMethod => ({
  name,
  authenticate: () => Promise.resolve(),
});

describe('GET /admin/runners/instances', () => {
  let app: FastifyInstance;
  let auth: AuthInterModuleClient;

  beforeEach(async () => {
    await closeApp();
    auth = {
      ...runnersTestAuthClient,
      requireAdminRole: vi.fn().mockResolvedValue({role: 'admin-observer'}),
    };
    app = await createApp({
      auth: [
        fakeUserAuth,
        passthroughAuth(AUTH_RUNNER_REGISTRATION_TOKEN),
        passthroughAuth(AUTH_RUNNER_SESSION),
        passthroughAuth(AUTH_LEASED_JOB),
        passthroughAuth(AUTH_PROVISIONER_TOKEN),
      ],
      routes: createRunnerRoutes(auth),
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  test('returns a bounded safe installation inventory with deterministic pagination', async () => {
    const label = `inventory-${crypto.randomUUID()}`;
    const provisioner = await provisionerTokenFactory.create({
      scope: 'installation',
      name: 'Cloud managed runners',
    });
    const now = new Date();
    await db()
      .update(provisionerTokens)
      .set({lastSeenAt: now})
      .where(eq(provisionerTokens.id, provisioner.id));

    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const assignedWorkspaceId = crypto.randomUUID();
    await db()
      .insert(providerRunners)
      .values([
        {
          id: firstId,
          workspaceId: assignedWorkspaceId,
          provisionerId: provisioner.id,
          providerRunnerId: 'provider-secret-1',
          reservationId: crypto.randomUUID(),
          assignedAt: new Date(now.getTime() - 4_000),
          labels: [label, 'linux'],
          state: 'running',
          providerKind: 'ec2',
          reportedAt: now,
          createdAt: new Date(now.getTime() - 2_000),
          updatedAt: now,
        },
        {
          id: secondId,
          workspaceId: null,
          provisionerId: provisioner.id,
          providerRunnerId: null,
          labels: [label],
          state: 'starting',
          reportedAt: now,
          createdAt: new Date(now.getTime() - 1_000),
          updatedAt: now,
        },
      ]);
    await db()
      .insert(runnerControlSessions)
      .values({
        runnerInstanceId: secondId,
        provisionerId: provisioner.id,
        hashedToken: `hash-${crypto.randomUUID()}`,
        prefix: 'test',
        expiresAt: new Date(now.getTime() + 60_000),
        lastSeenAt: now,
      });

    const firstPage = await app.inject({
      method: 'GET',
      url: `/admin/runners/instances?label=${label}&limit=1`,
      headers: {authorization: 'Bearer user'},
    });

    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json()).toMatchObject({
      runners: [
        {
          id: secondId,
          lifecycle_state: 'unassigned',
          compute_state: 'starting',
          enrollment_state: 'enrolled',
          assignment_presence: 'unassigned',
          assigned_workspace: null,
          labels: [label],
          provisioner: {
            id: provisioner.id,
            scope: 'installation',
            name: 'Cloud managed runners',
          },
          reconciliation_status: 'current',
        },
      ],
    });
    expect(firstPage.json().runners[0]).not.toHaveProperty('provider_runner_id');
    expect(firstPage.json().runners[0]).not.toHaveProperty('provider_kind');
    expect(firstPage.json().runners[0]).not.toHaveProperty('bootstrap_token');
    expect(firstPage.json().runners[0]).not.toHaveProperty('control_session_token');
    expect(firstPage.json().next_cursor).toEqual(expect.any(String));

    const secondPage = await app.inject({
      method: 'GET',
      url: `/admin/runners/instances?label=${label}&limit=1&cursor=${encodeURIComponent(firstPage.json().next_cursor)}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json()).toMatchObject({
      runners: [
        {
          id: firstId,
          lifecycle_state: 'assigned',
          compute_state: 'running',
          enrollment_state: 'pending',
          assignment_presence: 'assigned',
          assigned_workspace: {id: assignedWorkspaceId},
          labels: [label, 'linux'],
          closure_reason: null,
          closed_at: null,
          reconciliation_status: 'current',
        },
      ],
      next_cursor: null,
    });
  });

  test('checks bounded lifecycle, assignment, and label filters', async () => {
    const label = `filter-${crypto.randomUUID()}`;
    const provisioner = await provisionerTokenFactory.create({scope: 'installation'});
    const now = new Date();
    await db()
      .update(provisionerTokens)
      .set({lastSeenAt: now})
      .where(eq(provisionerTokens.id, provisioner.id));
    await db()
      .insert(providerRunners)
      .values([
        {
          provisionerId: provisioner.id,
          workspaceId: crypto.randomUUID(),
          providerRunnerId: 'filter-running',
          labels: [label],
          state: 'running',
          reportedAt: now,
        },
        {
          provisionerId: provisioner.id,
          workspaceId: null,
          providerRunnerId: 'filter-failed',
          labels: [label],
          state: 'failed',
          reason: 'launch-failed',
          failedAt: now,
          reportedAt: now,
        },
        {
          provisionerId: provisioner.id,
          workspaceId: crypto.randomUUID(),
          providerRunnerId: 'filter-other-label',
          labels: ['other'],
          state: 'running',
          reportedAt: now,
        },
      ]);

    const response = await app.inject({
      method: 'GET',
      url: `/admin/runners/instances?state=running&assignment=assigned&label=${label}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().runners).toHaveLength(1);
    expect(response.json().runners[0]).toMatchObject({
      compute_state: 'running',
      assignment_presence: 'assigned',
      labels: [label],
    });
  });

  test('reports activated and claimed lifecycle states', async () => {
    const label = `lifecycle-${crypto.randomUUID()}`;
    const provisioner = await provisionerTokenFactory.create({scope: 'installation'});
    const workspaceId = crypto.randomUUID();
    const claimedSession = await runnerSessionFactory.create({workspaceId});
    await db()
      .update(runnerSessions)
      .set({claimsUsed: 1})
      .where(eq(runnerSessions.id, claimedSession.id));

    const activatedId = crypto.randomUUID();
    const claimedId = crypto.randomUUID();
    const now = new Date();
    await db()
      .insert(providerRunners)
      .values([
        {
          id: activatedId,
          provisionerId: provisioner.id,
          workspaceId,
          runnerSessionId: crypto.randomUUID(),
          providerRunnerId: 'activated-provider',
          labels: [label],
          state: 'running',
          reportedAt: now,
        },
        {
          id: claimedId,
          provisionerId: provisioner.id,
          workspaceId,
          runnerSessionId: claimedSession.id,
          providerRunnerId: 'claimed-provider',
          labels: [label],
          state: 'running',
          reportedAt: now,
        },
      ]);

    const response = await app.inject({
      method: 'GET',
      url: `/admin/runners/instances?label=${label}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().runners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: activatedId,
          lifecycle_state: 'activated',
          enrollment_state: 'activated',
        }),
        expect.objectContaining({
          id: claimedId,
          lifecycle_state: 'claimed',
          enrollment_state: 'activated',
        }),
      ]),
    );
  });

  test('reports stale and unknown reconciliation states', async () => {
    const label = `reconciliation-${crypto.randomUUID()}`;
    const staleProvisioner = await provisionerTokenFactory.create({scope: 'installation'});
    const unknownProvisioner = await provisionerTokenFactory.create({scope: 'installation'});
    const staleAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db()
      .update(provisionerTokens)
      .set({lastSeenAt: staleAt})
      .where(eq(provisionerTokens.id, staleProvisioner.id));
    const staleId = crypto.randomUUID();
    const unknownId = crypto.randomUUID();
    await db()
      .insert(providerRunners)
      .values([
        {
          id: staleId,
          provisionerId: staleProvisioner.id,
          workspaceId: crypto.randomUUID(),
          providerRunnerId: 'stale-provider',
          labels: [label],
          state: 'running',
          reportedAt: new Date(),
        },
        {
          id: unknownId,
          provisionerId: unknownProvisioner.id,
          workspaceId: crypto.randomUUID(),
          providerRunnerId: 'unknown-provider',
          labels: [label],
          state: 'running',
          reportedAt: new Date(),
        },
      ]);

    const response = await app.inject({
      method: 'GET',
      url: `/admin/runners/instances?label=${label}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().runners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({id: staleId, reconciliation_status: 'stale'}),
        expect.objectContaining({id: unknownId, reconciliation_status: 'unknown'}),
      ]),
    );
  });

  test('matches a stored lowercase label regardless of filter casing', async () => {
    const label = `mixed-case-${crypto.randomUUID()}`;
    const provisioner = await provisionerTokenFactory.create({scope: 'installation'});
    await db()
      .insert(providerRunners)
      .values({
        provisionerId: provisioner.id,
        workspaceId: crypto.randomUUID(),
        providerRunnerId: `provider-${crypto.randomUUID()}`,
        labels: [label],
        state: 'running',
        reportedAt: new Date(),
      });

    const response = await app.inject({
      method: 'GET',
      url: `/admin/runners/instances?label=${label.toUpperCase()}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().runners).toHaveLength(1);
    expect(response.json().runners[0].labels).toEqual([label]);
  });

  test('returns an empty inventory when only workspace-scoped runners exist', async () => {
    const label = `empty-${crypto.randomUUID()}`;
    const workspaceProvisioner = await provisionerTokenFactory.create({
      scope: 'workspace',
      workspaceId: crypto.randomUUID(),
    });
    await db()
      .insert(providerRunners)
      .values({
        provisionerId: workspaceProvisioner.id,
        workspaceId: workspaceProvisioner.workspaceId,
        providerRunnerId: `workspace-${crypto.randomUUID()}`,
        labels: [label],
        state: 'running',
        reportedAt: new Date(),
      });

    const response = await app.inject({
      method: 'GET',
      url: `/admin/runners/instances?label=${label}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({runners: [], next_cursor: null});
  });

  test('requires the administrator observer role', async () => {
    vi.mocked(auth.requireAdminRole).mockRejectedValueOnce(
      createInterModuleKnownError(
        authInterModuleContract.methods.requireAdminRole,
        'admin-role-required',
        {requiredRole: 'admin-observer'},
      ),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/admin/runners/instances',
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'forbidden',
      details: {required_role: 'admin-observer'},
    });
    expect(auth.requireAdminRole).toHaveBeenCalledWith({
      userId: USER_ID,
      minimumRole: 'admin-observer',
    });
  });

  test('rejects oversized parameters and malformed cursors', async () => {
    const oversizedLimit = await app.inject({
      method: 'GET',
      url: '/admin/runners/instances?limit=101',
      headers: {authorization: 'Bearer user'},
    });
    const malformedCursor = await app.inject({
      method: 'GET',
      url: '/admin/runners/instances?cursor=not-a-cursor',
      headers: {authorization: 'Bearer user'},
    });

    expect(oversizedLimit.statusCode).toBe(400);
    expect(malformedCursor.statusCode).toBe(400);
  });

  test('returns terminal closure and explicit unknown reconciliation state', async () => {
    const label = `terminal-${crypto.randomUUID()}`;
    const provisioner = await provisionerTokenFactory.create({scope: 'installation'});
    const now = new Date();
    const closedAt = new Date(now.getTime() - 1_000);
    await db()
      .insert(providerRunners)
      .values({
        provisionerId: provisioner.id,
        workspaceId: null,
        providerRunnerId: 'terminal-provider',
        labels: [label],
        state: 'failed',
        reason: 'provider-launch-failed',
        failedAt: closedAt,
        reportedAt: now,
      });

    const response = await app.inject({
      method: 'GET',
      url: `/admin/runners/instances?label=${label}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().runners[0]).toMatchObject({
      closure_reason: 'provider-launch-failed',
      closed_at: closedAt.toISOString(),
      reconciliation_status: 'terminal',
    });
  });

  test('prioritizes terminal lifecycle over missing claim history', async () => {
    const label = `terminal-lifecycle-${crypto.randomUUID()}`;
    const provisioner = await provisionerTokenFactory.create({scope: 'installation'});
    const now = new Date();
    const closedAt = new Date(now.getTime() - 1_000);
    const runnerInstanceId = crypto.randomUUID();
    await db()
      .insert(providerRunners)
      .values({
        id: runnerInstanceId,
        provisionerId: provisioner.id,
        workspaceId: crypto.randomUUID(),
        runnerSessionId: crypto.randomUUID(),
        providerRunnerId: 'terminal-activated-provider',
        labels: [label],
        state: 'failed',
        reason: 'provider-launch-failed',
        failedAt: closedAt,
        reportedAt: now,
      });

    const response = await app.inject({
      method: 'GET',
      url: `/admin/runners/instances?label=${label}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().runners[0]).toMatchObject({
      id: runnerInstanceId,
      lifecycle_state: 'completed',
      enrollment_state: 'activated',
      reconciliation_status: 'terminal',
    });
  });

  test('prioritizes terminal lifecycle before activation state', async () => {
    const label = `terminal-unactivated-${crypto.randomUUID()}`;
    const provisioner = await provisionerTokenFactory.create({scope: 'installation'});
    const now = new Date();
    const closedAt = new Date(now.getTime() - 1_000);
    const runnerInstanceId = crypto.randomUUID();
    await db()
      .insert(providerRunners)
      .values({
        id: runnerInstanceId,
        provisionerId: provisioner.id,
        workspaceId: crypto.randomUUID(),
        runnerSessionId: null,
        providerRunnerId: 'terminal-unactivated-provider',
        labels: [label],
        state: 'terminated',
        reason: 'registration-timeout',
        terminatedAt: closedAt,
        reportedAt: now,
      });

    const response = await app.inject({
      method: 'GET',
      url: `/admin/runners/instances?label=${label}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().runners[0]).toMatchObject({
      id: runnerInstanceId,
      lifecycle_state: 'completed',
      enrollment_state: 'pending',
      reconciliation_status: 'terminal',
    });
  });

  test('does not treat closed control sessions as enrollment authority', async () => {
    const label = `closed-control-${crypto.randomUUID()}`;
    const provisioner = await provisionerTokenFactory.create({scope: 'installation'});
    const now = new Date();
    const runnerInstanceId = crypto.randomUUID();
    await db()
      .insert(providerRunners)
      .values({
        id: runnerInstanceId,
        provisionerId: provisioner.id,
        workspaceId: null,
        providerRunnerId: 'closed-control-provider',
        labels: [label],
        state: 'starting',
        reportedAt: now,
      });
    await db()
      .insert(runnerControlSessions)
      .values({
        runnerInstanceId,
        provisionerId: provisioner.id,
        hashedToken: `closed-${crypto.randomUUID()}`,
        prefix: 'test',
        expiresAt: now,
        lastSeenAt: now,
        closedAt: now,
        closeReason: 'activated',
      });

    const response = await app.inject({
      method: 'GET',
      url: `/admin/runners/instances?label=${label}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().runners[0].enrollment_state).toBe('pending');
  });

  test('does not treat expired control sessions as enrollment authority', async () => {
    const label = `expired-control-${crypto.randomUUID()}`;
    const provisioner = await provisionerTokenFactory.create({scope: 'installation'});
    const now = new Date();
    const runnerInstanceId = crypto.randomUUID();
    await db()
      .insert(providerRunners)
      .values({
        id: runnerInstanceId,
        provisionerId: provisioner.id,
        workspaceId: null,
        providerRunnerId: 'expired-control-provider',
        labels: [label],
        state: 'starting',
        reportedAt: now,
      });
    await db()
      .insert(runnerControlSessions)
      .values({
        runnerInstanceId,
        provisionerId: provisioner.id,
        hashedToken: `expired-${crypto.randomUUID()}`,
        prefix: 'test',
        expiresAt: new Date(now.getTime() - 1_000),
        lastSeenAt: now,
      });

    const response = await app.inject({
      method: 'GET',
      url: `/admin/runners/instances?label=${label}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().runners[0].enrollment_state).toBe('pending');
  });

  test('does not include a workspace-scoped installation row accidentally', async () => {
    const label = `scope-${crypto.randomUUID()}`;
    const installation = await provisionerTokenFactory.create({scope: 'installation'});
    const workspace = await provisionerTokenFactory.create({
      scope: 'workspace',
      workspaceId: crypto.randomUUID(),
    });
    await db()
      .insert(providerRunners)
      .values([
        {
          provisionerId: installation.id,
          workspaceId: null,
          providerRunnerId: 'installation-row',
          labels: [label],
          state: 'running',
          reportedAt: new Date(),
        },
        {
          provisionerId: workspace.id,
          workspaceId: workspace.workspaceId,
          providerRunnerId: 'workspace-row',
          labels: [label],
          state: 'running',
          reportedAt: new Date(),
        },
      ]);

    const response = await app.inject({
      method: 'GET',
      url: `/admin/runners/instances?label=${label}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().runners).toHaveLength(1);
    expect(response.json().runners[0].provisioner.id).toBe(installation.id);
  });
});
