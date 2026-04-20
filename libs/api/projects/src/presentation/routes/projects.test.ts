import {AUTH_USER, setUserContext} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {createVcsConnection} from '#db/index.js';
import {projectRoutes} from './index.js';

vi.mock('@shipfox/api-workspaces', () => ({
  requireMembership: vi.fn(({workspaceId, request}) =>
    Promise.resolve({
      workspaceId,
      workspace: {
        id: workspaceId,
        name: 'Workspace',
        status: 'active',
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      userId: 'user-1',
      request,
    }),
  ),
}));

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    setUserContext(request, {userId: 'user-1', email: 'user@example.com'});
    return Promise.resolve();
  },
};

describe('project routes', () => {
  let app: FastifyInstance;
  let workspaceId: string;

  beforeEach(async () => {
    await closeApp();
    workspaceId = crypto.randomUUID();
    app = await createApp({
      auth: [fakeUserAuth],
      routes: projectRoutes,
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  test('creates a test VCS connection', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/vcs-connections',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        provider: 'test',
        provider_host: 'test.local',
        external_connection_id: 'installation-1',
        display_name: 'Test Installation',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().workspace_id).toBe(workspaceId);
    expect(res.json().provider).toBe('test');
  });

  test('creates a project for a repository without requiring workflow definitions', async () => {
    const connection = await createVcsConnection({
      workspaceId,
      provider: 'test',
      providerHost: 'test.local',
      externalConnectionId: 'installation-1',
      displayName: 'Test Installation',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: 'Platform',
        vcs_connection_id: connection.id,
        external_repository_id: 'platform',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('Platform');
    expect(res.json().repository.full_name).toBe('test-owner/platform');
  });

  test('lists projects for a workspace', async () => {
    const connection = await createVcsConnection({
      workspaceId,
      provider: 'test',
      providerHost: 'test.local',
      externalConnectionId: 'installation-1',
      displayName: 'Test Installation',
    });
    const createRes = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: 'Platform',
        vcs_connection_id: connection.id,
        external_repository_id: 'platform',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/projects?workspace_id=${workspaceId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(createRes.statusCode).toBe(201);
    expect(res.statusCode).toBe(200);
    expect(res.json().projects.map((project: {id: string}) => project.id)).toContain(
      createRes.json().id,
    );
  });

  test('returns 409 when a workspace already has a project for the repository', async () => {
    const connection = await createVcsConnection({
      workspaceId,
      provider: 'test',
      providerHost: 'test.local',
      externalConnectionId: 'installation-1',
      displayName: 'Test Installation',
    });
    const payload = {
      workspace_id: workspaceId,
      name: 'Platform',
      vcs_connection_id: connection.id,
      external_repository_id: 'platform',
    };
    await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('project-already-exists');
  });
});
