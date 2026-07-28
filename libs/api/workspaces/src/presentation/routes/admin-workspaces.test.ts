import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import {ADMINISTRATION_ACTION_PERFORMED} from '@shipfox/api-common-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {type AuthMethod, closeApp, createApp} from '@shipfox/node-fastify';
import {eq, sql} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {createInvitation, listOpenInvitationsByWorkspace} from '#db/invitations.js';
import {createMembership, listMembershipsByWorkspace} from '#db/memberships.js';
import {workspacesAdminCommandResults} from '#db/schema/admin-command-results.js';
import {workspacesOutbox} from '#db/schema/outbox.js';
import {createWorkspace, getWorkspaceById, updateWorkspace} from '#db/workspaces.js';
import {createAdminWorkspacesRoutes} from './admin-workspaces.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function adminHeaders(idempotencyKey: string) {
  return {
    authorization: 'Bearer user',
    'idempotency-key': idempotencyKey,
  };
}

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    setUserContext(
      request,
      buildUserContext({userId: USER_ID, email: 'admin@example.com', memberships: []}),
    );
    return Promise.resolve();
  },
};

describe('GET /admin/workspaces', () => {
  let app: FastifyInstance;
  let auth: AuthInterModuleClient;
  let projects: ProjectsModuleClient;
  let runners: RunnersInterModuleClient;

  beforeEach(async () => {
    await closeApp();
    await db().execute(
      sql`TRUNCATE workspaces_admin_command_results, workspaces_outbox, workspaces_workspaces CASCADE`,
    );
    auth = {
      requireAdminRole: vi
        .fn()
        .mockImplementation(({minimumRole}) => Promise.resolve({role: minimumRole})),
    } as unknown as AuthInterModuleClient;
    projects = {
      getWorkspaceProjectCounts: vi.fn().mockResolvedValue({counts: []}),
    } as unknown as ProjectsModuleClient;
    runners = {
      getWorkspaceJobCounts: vi.fn().mockResolvedValue({counts: []}),
    } as unknown as RunnersInterModuleClient;
    app = await createApp({
      auth: [fakeUserAuth],
      routes: [createAdminWorkspacesRoutes({auth, projects, runners})],
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  test('returns a bounded safe workspace summary for an observer', async () => {
    const workspace = await createWorkspace({name: `Admin lookup ${crypto.randomUUID()}`});
    await createMembership({userId: crypto.randomUUID(), workspaceId: workspace.id});
    vi.mocked(projects.getWorkspaceProjectCounts).mockResolvedValue({
      counts: [{workspaceId: workspace.id, count: 3}],
    });
    vi.mocked(runners.getWorkspaceJobCounts).mockResolvedValue({
      counts: [{workspaceId: workspace.id, queued: 2, running: 1}],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/admin/workspaces?workspace_id=${workspace.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workspaces: [
        {
          id: workspace.id,
          name: workspace.name,
          status: 'active',
          member_summary: {count: 1},
          project_summary: {state: 'available', count: 3},
          job_counts: {state: 'available', queued: 2, running: 1},
        },
      ],
      next_cursor: null,
    });
    expect(response.json().workspaces[0]).not.toHaveProperty('settings');
    expect(response.json().workspaces[0]).not.toHaveProperty('administrator');
    expect(auth.requireAdminRole).toHaveBeenCalledWith({
      userId: USER_ID,
      minimumRole: 'admin-observer',
    });
  });

  test('suspends a workspace without deleting its data and writes one redacted event', async () => {
    const workspace = await createWorkspace({name: `Suspend ${crypto.randomUUID()}`});
    await updateWorkspace({id: workspace.id, settings: {retained: true}});
    await createMembership({userId: crypto.randomUUID(), workspaceId: workspace.id});
    await createInvitation({
      workspaceId: workspace.id,
      email: `pending-${crypto.randomUUID()}@example.com`,
      hashedToken: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      invitedByUserId: USER_ID,
      skipEmail: true,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders('suspend-workspace'),
      payload: {reason: 'Requested by support'},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({workspace_id: workspace.id, status: 'suspended'});
    expect(body.correlation_id).toEqual(expect.any(String));
    await expect(getWorkspaceById(workspace.id)).resolves.toMatchObject({
      id: workspace.id,
      status: 'suspended',
      settings: {retained: true},
    });
    await expect(listMembershipsByWorkspace({workspaceId: workspace.id})).resolves.toHaveLength(1);
    await expect(listOpenInvitationsByWorkspace({workspaceId: workspace.id})).resolves.toHaveLength(
      1,
    );

    const events = await db()
      .select()
      .from(workspacesOutbox)
      .where(eq(workspacesOutbox.eventType, ADMINISTRATION_ACTION_PERFORMED));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: ADMINISTRATION_ACTION_PERFORMED,
      payload: {
        actorId: USER_ID,
        actorRole: 'admin-operator',
        requiredRole: 'admin-operator',
        command: 'workspace.suspend',
        targetType: 'workspace',
        targetId: workspace.id,
        reason: 'Requested by support',
        result: 'succeeded',
        correlationId: body.correlation_id,
      },
    });
    expect(events[0]?.payload).not.toHaveProperty('idempotencyKey');
    await expect(
      db()
        .select()
        .from(workspacesAdminCommandResults)
        .where(eq(workspacesAdminCommandResults.actorId, USER_ID)),
    ).resolves.toHaveLength(1);
  });

  test('returns the committed suspension result on an idempotent retry', async () => {
    const workspace = await createWorkspace({name: `Retry ${crypto.randomUUID()}`});
    const first = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders('retry-workspace-suspend'),
      payload: {reason: 'Retry test'},
    });
    const retry = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders('retry-workspace-suspend'),
      payload: {reason: 'Retry test'},
    });

    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    await expect(
      db()
        .select()
        .from(workspacesAdminCommandResults)
        .where(eq(workspacesAdminCommandResults.actorId, USER_ID)),
    ).resolves.toHaveLength(1);
    await expect(
      db()
        .select()
        .from(workspacesOutbox)
        .where(eq(workspacesOutbox.eventType, ADMINISTRATION_ACTION_PERFORMED)),
    ).resolves.toHaveLength(1);
  });

  test('reactivates a suspended workspace without replaying rejected work', async () => {
    const workspace = await createWorkspace({name: `Reactivate ${crypto.randomUUID()}`});
    await createMembership({userId: crypto.randomUUID(), workspaceId: workspace.id});

    const suspended = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders('reactivation-suspend'),
      payload: {reason: 'Temporary suspension'},
    });
    const reactivated = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/reactivate`,
      headers: adminHeaders('reactivation-reactivate'),
      payload: {reason: 'Issue resolved'},
    });

    expect(suspended.statusCode).toBe(200);
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json()).toMatchObject({workspace_id: workspace.id, status: 'active'});
    await expect(getWorkspaceById(workspace.id)).resolves.toMatchObject({status: 'active'});
    await expect(listMembershipsByWorkspace({workspaceId: workspace.id})).resolves.toHaveLength(1);
    await expect(
      db()
        .select()
        .from(workspacesOutbox)
        .where(eq(workspacesOutbox.eventType, ADMINISTRATION_ACTION_PERFORMED)),
    ).resolves.toHaveLength(2);
  });

  test('rejects reusing an idempotency key for another workspace command', async () => {
    const workspace = await createWorkspace({name: `Reuse ${crypto.randomUUID()}`});
    const suspended = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders('reused-workspace-key'),
      payload: {reason: 'Reuse test'},
    });
    const reused = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/reactivate`,
      headers: adminHeaders('reused-workspace-key'),
      payload: {reason: 'Reuse test'},
    });

    expect(suspended.statusCode).toBe(200);
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({code: 'idempotency-key-reused'});
    await expect(getWorkspaceById(workspace.id)).resolves.toMatchObject({status: 'suspended'});
  });

  test.each([
    ['missing', undefined],
    ['blank', '   '],
    ['oversized', 'x'.repeat(257)],
  ])('requires an idempotency key when it is %s', async (_case, idempotencyKey) => {
    const workspace = await createWorkspace({name: `Key ${crypto.randomUUID()}`});
    const response = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: {
        authorization: 'Bearer user',
        ...(idempotencyKey === undefined ? {} : {'idempotency-key': idempotencyKey}),
      },
      payload: {reason: 'Missing key test'},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('idempotency-key-required');
  });

  test.each([
    ['empty', ''],
    ['oversized', 'x'.repeat(513)],
    ['control character', 'Reason\nwith control'],
    ['format character', 'Reason\u202ewith format character'],
  ])('rejects a %s administration reason', async (_case, reason) => {
    const workspace = await createWorkspace({name: `Reason ${crypto.randomUUID()}`});
    const response = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders(`invalid-reason-${crypto.randomUUID()}`),
      payload: {reason},
    });

    expect(response.statusCode).toBe(400);
  });

  test('returns not found for an unknown workspace', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${crypto.randomUUID()}/suspend`,
      headers: adminHeaders('unknown-workspace'),
      payload: {reason: 'Unknown workspace test'},
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('workspace-not-found');
  });

  test('rejects suspending an already suspended workspace with a fresh key', async () => {
    const workspace = await createWorkspace({name: `Already suspended ${crypto.randomUUID()}`});
    const first = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders('already-suspended-first'),
      payload: {reason: 'First suspension'},
    });
    const second = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders('already-suspended-second'),
      payload: {reason: 'Second suspension'},
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('workspace-already-suspended');
  });

  test('rejects reactivating an active workspace', async () => {
    const workspace = await createWorkspace({name: `Already active ${crypto.randomUUID()}`});
    const response = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/reactivate`,
      headers: adminHeaders('already-active-reactivate'),
      payload: {reason: 'Already active test'},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('workspace-not-suspended');
  });

  test('rejects mutating a deleted workspace', async () => {
    const workspace = await createWorkspace({name: `Deleted ${crypto.randomUUID()}`});
    await updateWorkspace({id: workspace.id, status: 'deleted'});
    const response = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders('deleted-workspace'),
      payload: {reason: 'Deleted workspace test'},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('workspace-deleted');
  });

  test('does not expose a versioned administration namespace', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/v1/workspaces/00000000-0000-4000-8000-000000000001/suspend',
      headers: adminHeaders('versioned-route'),
      payload: {reason: 'Should not route'},
    });

    expect(response.statusCode).toBe(404);
  });

  test('returns explicit unknown job counts when the supporting lookup fails', async () => {
    const workspace = await createWorkspace({name: `Unknown jobs ${crypto.randomUUID()}`});
    vi.mocked(projects.getWorkspaceProjectCounts).mockResolvedValue({
      counts: [{workspaceId: workspace.id, count: 0}],
    });
    vi.mocked(runners.getWorkspaceJobCounts).mockRejectedValue(new Error('runner service down'));

    const response = await app.inject({
      method: 'GET',
      url: `/admin/workspaces?workspace_id=${workspace.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().workspaces[0]).toMatchObject({
      project_summary: {state: 'available', count: 0},
      job_counts: {state: 'unknown'},
    });
  });

  test('keeps known supporting counts when a response omits another workspace', async () => {
    const prefix = `Partial counts ${crypto.randomUUID()}`;
    const firstWorkspace = await createWorkspace({name: `${prefix} Alpha`});
    const secondWorkspace = await createWorkspace({name: `${prefix} Beta`});
    vi.mocked(projects.getWorkspaceProjectCounts).mockResolvedValue({
      counts: [{workspaceId: firstWorkspace.id, count: 2}],
    });
    vi.mocked(runners.getWorkspaceJobCounts).mockResolvedValue({
      counts: [{workspaceId: firstWorkspace.id, queued: 1, running: 2}],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/admin/workspaces?search=${encodeURIComponent(prefix)}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().workspaces).toEqual([
      expect.objectContaining({
        id: firstWorkspace.id,
        project_summary: {state: 'available', count: 2},
        job_counts: {state: 'available', queued: 1, running: 2},
      }),
      expect.objectContaining({
        id: secondWorkspace.id,
        project_summary: {state: 'unknown'},
        job_counts: {state: 'unknown'},
      }),
    ]);
  });

  test('maps an insufficient administrator role to forbidden', async () => {
    vi.mocked(auth.requireAdminRole).mockRejectedValue(
      createInterModuleKnownError(
        authInterModuleContract.methods.requireAdminRole,
        'admin-role-required',
        {requiredRole: 'admin-observer'},
      ),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/admin/workspaces',
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'forbidden',
      details: {required_role: 'admin-observer'},
    });
  });
});
