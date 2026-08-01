import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {sql} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import type {Project} from '#core/entities/project.js';
import {db} from '#db/db.js';
import {createProject} from '#db/projects.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {createProjectRoutes} from './index.js';

let authenticatedMemberships: UserContextMembership[] = [];

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    setUserContext(
      request,
      buildUserContext({
        userId: 'user-1',
        email: 'user@example.com',
        name: 'User One',
        memberships: authenticatedMemberships,
      }),
    );
    return Promise.resolve();
  },
};

describe('project routes', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let sourceConnectionId: string;
  let integrations: Pick<IntegrationsModuleClient, 'resolveSourceRepository'>;
  let auth: Pick<AuthInterModuleClient, 'requireAdminRole'>;

  beforeEach(async () => {
    await closeApp();
    workspaceId = crypto.randomUUID();
    sourceConnectionId = crypto.randomUUID();
    authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
    integrations = {
      resolveSourceRepository: vi.fn(async () => {
        await Promise.resolve();
        return {
          connection: {
            id: sourceConnectionId,
            provider: 'gitea' as const,
            slug: 'gitea_owner',
          },
          repository: {
            externalRepositoryId: 'gitea:gitea-owner/platform',
            owner: 'gitea-owner',
            name: 'platform',
            fullName: 'gitea-owner/platform',
            defaultBranch: 'main',
            visibility: 'private' as const,
            cloneUrl: 'https://gitea.local/gitea-owner/platform.git',
            htmlUrl: 'https://gitea.local/gitea-owner/platform',
          },
        };
      }),
    };
    auth = {
      requireAdminRole: vi.fn().mockResolvedValue({role: 'admin-observer'}),
    };
    app = await createApp({
      auth: [fakeUserAuth],
      routes: createProjectRoutes(integrations as IntegrationsModuleClient, auth),
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
        name: '  Platform  ',
        slug: 'platform',
        source: {
          connection_id: sourceConnectionId,
          external_repository_id: 'gitea:gitea-owner/platform',
        },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('Platform');
    expect(res.json().slug).toBe('platform');
    expect(res.json().source).toEqual({
      connection_id: sourceConnectionId,
      external_repository_id: 'gitea:gitea-owner/platform',
    });
  });

  test('returns a distinct conflict when a slug is taken in the workspace', async () => {
    await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: 'Platform',
        slug: 'platform',
        source: {
          connection_id: sourceConnectionId,
          external_repository_id: 'gitea:gitea-owner/platform',
        },
      },
    });
    vi.mocked(integrations.resolveSourceRepository).mockResolvedValueOnce({
      connection: {
        id: crypto.randomUUID(),
        provider: 'gitea',
        slug: 'gitea_owner',
      },
      repository: {
        externalRepositoryId: 'gitea:gitea-owner/other',
        owner: 'gitea-owner',
        name: 'other',
        fullName: 'gitea-owner/other',
        defaultBranch: 'main',
        visibility: 'private',
        cloneUrl: 'https://gitea.local/gitea-owner/other.git',
        htmlUrl: 'https://gitea.local/gitea-owner/other',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: 'Other',
        slug: 'platform',
        source: {
          connection_id: crypto.randomUUID(),
          external_repository_id: 'gitea:gitea-owner/other',
        },
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('slug-conflict');
    expect(res.json().code).not.toBe('project-already-exists');
  });

  test('allows the same slug in different workspaces', async () => {
    const secondWorkspaceId = crypto.randomUUID();
    authenticatedMemberships = [
      {workspaceId, role: 'admin', workspaceStatus: 'active'},
      {workspaceId: secondWorkspaceId, role: 'admin', workspaceStatus: 'active'},
    ];
    await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: 'Platform',
        slug: 'platform',
        source: {
          connection_id: sourceConnectionId,
          external_repository_id: 'gitea:gitea-owner/platform',
        },
      },
    });
    vi.mocked(integrations.resolveSourceRepository).mockResolvedValueOnce({
      connection: {
        id: crypto.randomUUID(),
        provider: 'gitea',
        slug: 'gitea_owner',
      },
      repository: {
        externalRepositoryId: 'gitea:gitea-owner/other-workspace',
        owner: 'gitea-owner',
        name: 'other-workspace',
        fullName: 'gitea-owner/other-workspace',
        defaultBranch: 'main',
        visibility: 'private',
        cloneUrl: 'https://gitea.local/gitea-owner/other-workspace.git',
        htmlUrl: 'https://gitea.local/gitea-owner/other-workspace',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: secondWorkspaceId,
        name: 'Platform',
        slug: 'platform',
        source: {
          connection_id: crypto.randomUUID(),
          external_repository_id: 'gitea:gitea-owner/other-workspace',
        },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().slug).toBe('platform');
  });

  test('accepts a project slug named new', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: 'New Project',
        slug: 'new',
        source: {
          connection_id: sourceConnectionId,
          external_repository_id: 'gitea:gitea-owner/platform',
        },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().slug).toBe('new');
  });

  test('renames a project, frees the old slug, and writes an update event', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: 'Platform',
        slug: 'platform',
        source: {
          connection_id: sourceConnectionId,
          external_repository_id: 'gitea:gitea-owner/platform',
        },
      },
    });

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/projects/${createRes.json().id}`,
      headers: {authorization: 'Bearer user'},
      payload: {name: 'Renamed Platform', slug: 'renamed-platform'},
    });

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json()).toMatchObject({
      name: 'Renamed Platform',
      slug: 'renamed-platform',
    });

    const events = await db()
      .select()
      .from(projectsOutbox)
      .where(sql`${projectsOutbox.payload}->>'projectId' = ${createRes.json().id}`);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'projects.project.updated',
          payload: expect.objectContaining({
            name: 'Renamed Platform',
            slug: 'renamed-platform',
          }),
        }),
      ]),
    );

    vi.mocked(integrations.resolveSourceRepository).mockResolvedValueOnce({
      connection: {
        id: crypto.randomUUID(),
        provider: 'gitea',
        slug: 'gitea_owner',
      },
      repository: {
        externalRepositoryId: 'gitea:gitea-owner/other',
        owner: 'gitea-owner',
        name: 'other',
        fullName: 'gitea-owner/other',
        defaultBranch: 'main',
        visibility: 'private',
        cloneUrl: 'https://gitea.local/gitea-owner/other.git',
        htmlUrl: 'https://gitea.local/gitea-owner/other',
      },
    });
    const reuseRes = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: 'Other',
        slug: 'platform',
        source: {
          connection_id: crypto.randomUUID(),
          external_repository_id: 'gitea:gitea-owner/other',
        },
      },
    });
    expect(reuseRes.statusCode).toBe(201);
  });

  test('treats an empty project update as a no-op', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: 'Platform',
        slug: 'platform',
        source: {
          connection_id: sourceConnectionId,
          external_repository_id: 'gitea:gitea-owner/platform',
        },
      },
    });
    const created = createRes.json();
    const beforeEvents = await db()
      .select()
      .from(projectsOutbox)
      .where(sql`${projectsOutbox.payload}->>'projectId' = ${created.id}`);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/projects/${created.id}`,
      headers: {authorization: 'Bearer user'},
      payload: {},
    });

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json()).toMatchObject({
      name: 'Platform',
      slug: 'platform',
      updated_at: created.updated_at,
    });
    const afterEvents = await db()
      .select()
      .from(projectsOutbox)
      .where(sql`${projectsOutbox.payload}->>'projectId' = ${created.id}`);
    expect(afterEvents).toHaveLength(beforeEvents.length);
  });

  test('returns a slug conflict when updating to another project slug', async () => {
    const first = await createProject({
      workspaceId,
      name: 'Platform',
      slug: 'platform',
      sourceConnectionId: crypto.randomUUID(),
      sourceExternalRepositoryId: 'gitea:platform',
    });
    const second = await createProject({
      workspaceId,
      name: 'Other',
      slug: 'other',
      sourceConnectionId: crypto.randomUUID(),
      sourceExternalRepositoryId: 'gitea:other',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/projects/${second.id}`,
      headers: {authorization: 'Bearer user'},
      payload: {slug: first.slug},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('slug-conflict');
  });

  test.each([
    ['blank after trimming', '   '],
    ['with control characters', 'Plat\nform'],
    ['with format characters', 'Plat\u202eform'],
  ])('rejects a project name %s before resolving the repository', async (_case, name) => {
    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name,
        slug: 'invalid-name',
        source: {
          connection_id: sourceConnectionId,
          external_repository_id: 'gitea:gitea-owner/platform',
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(integrations.resolveSourceRepository).not.toHaveBeenCalled();
  });

  test('lists projects for a workspace with source references', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: 'Platform',
        slug: 'platform',
        source: {
          connection_id: sourceConnectionId,
          external_repository_id: 'gitea:gitea-owner/platform',
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

  test('filters projects by `search` (case-insensitive substring on name or slug)', async () => {
    const projects = [
      {name: 'Platform', slug: 'platform'},
      {name: 'Runner', slug: 'runner'},
      {name: 'Notifier', slug: 'notifier'},
      {name: 'Cloud', slug: 'runnbox'},
    ];
    for (const [index, {name, slug}] of projects.entries()) {
      vi.mocked(integrations.resolveSourceRepository).mockResolvedValueOnce({
        connection: {
          id: sourceConnectionId,
          provider: 'gitea',
          slug: 'gitea_owner',
        },
        repository: {
          externalRepositoryId: `gitea:gitea-owner/${name.toLowerCase()}-${index}`,
          owner: 'gitea-owner',
          name: name.toLowerCase(),
          fullName: `gitea-owner/${name.toLowerCase()}`,
          defaultBranch: 'main',
          visibility: 'private',
          cloneUrl: `https://gitea.local/gitea-owner/${name.toLowerCase()}.git`,
          htmlUrl: `https://gitea.local/gitea-owner/${name.toLowerCase()}`,
        },
      });
      await app.inject({
        method: 'POST',
        url: '/projects',
        headers: {authorization: 'Bearer user'},
        payload: {
          workspace_id: workspaceId,
          name,
          slug,
          source: {
            connection_id: sourceConnectionId,
            external_repository_id: `gitea:gitea-owner/${name.toLowerCase()}-${index}`,
          },
        },
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: `/projects?workspace_id=${workspaceId}&search=runn`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    const returned = res.json().projects.map((project: {name: string}) => project.name);
    expect(returned).toEqual(['Cloud', 'Runner']);
  });

  test('returns 409 when the source repository already has a project', async () => {
    const payload = {
      workspace_id: workspaceId,
      name: 'Platform',
      slug: 'platform',
      source: {
        connection_id: sourceConnectionId,
        external_repository_id: 'gitea:gitea-owner/platform',
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
    vi.mocked(integrations.resolveSourceRepository).mockRejectedValueOnce(
      createInterModuleKnownError(
        integrationsInterModuleContract.methods.resolveSourceRepository,
        'connection-not-found',
        {connectionId: sourceConnectionId},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: 'Platform',
        slug: 'platform',
        source: {
          connection_id: sourceConnectionId,
          external_repository_id: 'gitea:gitea-owner/platform',
        },
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('source-connection-not-found');
  });

  test('requires the administrator observer role for project lookup', async () => {
    vi.mocked(auth.requireAdminRole).mockRejectedValueOnce(
      createInterModuleKnownError(
        authInterModuleContract.methods.requireAdminRole,
        'admin-role-required',
        {requiredRole: 'admin-observer'},
      ),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/admin/projects',
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: 'forbidden',
      details: {required_role: 'admin-observer'},
    });
    expect(auth.requireAdminRole).toHaveBeenCalledWith({
      userId: 'user-1',
      minimumRole: 'admin-observer',
    });
  });

  test('rejects unbounded lookup parameters and malformed cursors', async () => {
    const oversizedLimit = await app.inject({
      method: 'GET',
      url: '/admin/projects?limit=101',
      headers: {authorization: 'Bearer user'},
    });
    expect(oversizedLimit.statusCode).toBe(400);

    const oversizedSearch = await app.inject({
      method: 'GET',
      url: `/admin/projects?search=${'x'.repeat(101)}`,
      headers: {authorization: 'Bearer user'},
    });
    expect(oversizedSearch.statusCode).toBe(400);

    const malformedCursor = await app.inject({
      method: 'GET',
      url: '/admin/projects?cursor=not-a-cursor',
      headers: {authorization: 'Bearer user'},
    });
    expect(malformedCursor.statusCode).toBe(400);
    expect(malformedCursor.json().code).toBe('invalid-cursor');
  });

  test('returns a bounded redacted summary with checked search and cursor pagination', async () => {
    const projects: Project[] = [];
    for (const name of ['Platform', 'Runner', 'Running', 'Notifier']) {
      projects.push(
        await createProject({
          workspaceId,
          name,
          slug: name.toLowerCase(),
          sourceConnectionId: crypto.randomUUID(),
          sourceExternalRepositoryId: `gitea:${name.toLowerCase()}`,
        }),
      );
    }
    const running = projects.find((project) => project.name === 'Running');
    if (!running) throw new Error('Running project fixture was not created');

    const searchRes = await app.inject({
      method: 'GET',
      url: '/admin/projects?search=runn&limit=1',
      headers: {authorization: 'Bearer user'},
    });

    expect(searchRes.statusCode).toBe(200);
    expect(searchRes.json()).toMatchObject({
      projects: [
        {
          id: running.id,
          name: 'Running',
          status: 'active',
          workspace_id: workspaceId,
        },
      ],
      next_cursor: expect.any(String),
    });
    expect(searchRes.json().projects[0]).not.toHaveProperty('source');
    expect(searchRes.json().projects[0]).not.toHaveProperty('source_connection_id');
    expect(searchRes.json().projects[0]).not.toHaveProperty('source_external_repository_id');

    const firstPage = await app.inject({
      method: 'GET',
      url: '/admin/projects?limit=1',
      headers: {authorization: 'Bearer user'},
    });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().projects).toHaveLength(1);
    expect(firstPage.json().next_cursor).toEqual(expect.any(String));

    const secondPage = await app.inject({
      method: 'GET',
      url: `/admin/projects?limit=1&cursor=${encodeURIComponent(firstPage.json().next_cursor)}`,
      headers: {authorization: 'Bearer user'},
    });
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json().projects).toHaveLength(1);
    expect(secondPage.json().projects[0].id).not.toBe(firstPage.json().projects[0].id);
  });

  test('lists summaries across workspaces', async () => {
    const firstWorkspaceId = crypto.randomUUID();
    const secondWorkspaceId = crypto.randomUUID();
    const firstProject = await createProject({
      workspaceId: firstWorkspaceId,
      name: 'GlobalAdminLookupAlpha',
      slug: 'global-admin-lookup-alpha',
      sourceConnectionId: crypto.randomUUID(),
      sourceExternalRepositoryId: 'gitea:global-admin-lookup-alpha',
    });
    const secondProject = await createProject({
      workspaceId: secondWorkspaceId,
      name: 'GlobalAdminLookupBeta',
      slug: 'global-admin-lookup-beta',
      sourceConnectionId: crypto.randomUUID(),
      sourceExternalRepositoryId: 'gitea:global-admin-lookup-beta',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/projects?search=globaladminlookup&limit=100',
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({id: firstProject.id, workspace_id: firstWorkspaceId}),
        expect.objectContaining({id: secondProject.id, workspace_id: secondWorkspaceId}),
      ]),
    );
  });

  test('supports exact project ID lookup without exposing provider references', async () => {
    const project = await createProject({
      workspaceId,
      name: 'Platform',
      slug: 'platform',
      sourceConnectionId: crypto.randomUUID(),
      sourceExternalRepositoryId: 'gitea:platform',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/admin/projects?project_id=${project.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().projects).toHaveLength(1);
    expect(res.json().projects[0]).toMatchObject({
      id: project.id,
      name: 'Platform',
      status: 'active',
      workspace_id: workspaceId,
    });
    expect(res.json().projects[0]).not.toHaveProperty('source');
  });
});
