import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {type AuthMethod, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {createMembership} from '#db/memberships.js';
import {createWorkspace} from '#db/workspaces.js';
import {createAdminWorkspacesRoutes} from './admin-workspaces.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

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
    auth = {
      requireAdminRole: vi.fn().mockResolvedValue({role: 'admin-observer'}),
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
