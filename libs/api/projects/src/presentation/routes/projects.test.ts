import {AUTH_USER, setUserContext} from '@shipfox/api-auth-context';
import type {IntegrationSourceControlService} from '@shipfox/api-integration-core';
import {IntegrationConnectionNotFoundError} from '@shipfox/api-integration-core';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {createProjectRoutes} from './index.js';

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
  let sourceConnectionId: string;
  let sourceControl: IntegrationSourceControlService;

  beforeEach(async () => {
    await closeApp();
    workspaceId = crypto.randomUUID();
    sourceConnectionId = crypto.randomUUID();
    sourceControl = {
      getConnection: vi.fn(),
      listRepositories: vi.fn(),
      resolveRepository: vi.fn(async () => {
        await Promise.resolve();
        return {
          connection: {
            id: sourceConnectionId,
            workspaceId,
            provider: 'debug' as const,
            externalAccountId: 'debug',
            displayName: 'Debug Source Control',
            lifecycleStatus: 'active' as const,
            capabilities: ['source_control' as const],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          repository: {
            externalRepositoryId: 'platform',
            owner: 'debug-owner',
            name: 'platform',
            fullName: 'debug-owner/platform',
            defaultBranch: 'main',
            visibility: 'private' as const,
            cloneUrl: 'https://debug.local/debug-owner/platform.git',
            htmlUrl: 'https://debug.local/debug-owner/platform',
          },
        };
      }),
    };
    app = await createApp({
      auth: [fakeUserAuth],
      routes: createProjectRoutes(sourceControl),
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  test('creates a project for a source repository', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: 'Platform',
        source: {
          connection_id: sourceConnectionId,
          external_repository_id: 'platform',
        },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('Platform');
    expect(res.json().source).toEqual({
      connection_id: sourceConnectionId,
      external_repository_id: 'platform',
    });
  });

  test('lists projects for a workspace with source references', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: 'Platform',
        source: {
          connection_id: sourceConnectionId,
          external_repository_id: 'platform',
        },
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
    expect(res.json().projects[0].source.connection_id).toBe(sourceConnectionId);
  });

  test('returns 409 when the source repository already has a project', async () => {
    const payload = {
      workspace_id: workspaceId,
      name: 'Platform',
      source: {
        connection_id: sourceConnectionId,
        external_repository_id: 'platform',
      },
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
    expect(res.json().details.source_connection_id).toBe(sourceConnectionId);
  });

  test('maps missing source connections to a stable error', async () => {
    vi.mocked(sourceControl.resolveRepository).mockRejectedValueOnce(
      new IntegrationConnectionNotFoundError(sourceConnectionId),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: 'Platform',
        source: {
          connection_id: sourceConnectionId,
          external_repository_id: 'platform',
        },
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('source-connection-not-found');
  });
});
