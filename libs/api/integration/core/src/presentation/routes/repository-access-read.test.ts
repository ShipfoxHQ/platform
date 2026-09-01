import type {UserContextMembership} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {vi} from '@shipfox/vitest/vi';
import {upsertIntegrationConnection} from '#db/connections.js';
import {upsertIntegrationConnectionRepositoryGrant} from '#db/repository-grants.js';
import {createTestApp, sourceProvider, useIntegrationRouteTest} from '#test/route-utils.js';

describe('GET /integration-connections/:connectionId/repository-access', () => {
  const context = useIntegrationRouteTest();

  it('returns an empty selected view without provider calls', async () => {
    const provider = sourceProvider({repositoryAuthorization: 'enforced'});
    const sourceControl = provider.adapters?.source_control;
    if (!sourceControl) throw new Error('Expected source-control adapter');
    const listRepositories = vi.spyOn(sourceControl, 'listRepositories');
    const listProjectsBySourceConnection = vi.fn(async () => ({
      projects: [],
      nextCursor: null,
    }));
    const app = await createTestApp([provider], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: 'selected',
      repositories: [],
      next_cursor: null,
    });
    expect(listProjectsBySourceConnection).toHaveBeenCalledWith({
      workspaceId: context.workspaceId,
      sourceConnectionId: connection.id,
      limit: 50,
    });
    expect(listRepositories).not.toHaveBeenCalled();
  });

  it('composes project and manual provenance into one repository row', async () => {
    const provider = sourceProvider({repositoryAuthorization: 'enforced'});
    const sourceControl = provider.adapters?.source_control;
    if (!sourceControl) throw new Error('Expected source-control adapter');
    const listRepositories = vi.spyOn(sourceControl, 'listRepositories');
    const projectId = crypto.randomUUID();
    const listProjectsBySourceConnection = vi.fn(async () => ({
      projects: [
        {
          externalRepositoryId: 'gitea:gitea-owner/platform',
          owner: 'gitea-owner',
          name: 'platform',
          projectId,
          projectName: 'Platform',
        },
      ],
      nextCursor: null,
    }));
    const app = await createTestApp([provider], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();
    const grant = await createGrant(connection.id);

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: 'selected',
      repositories: [
        {
          external_repository_id: 'gitea:gitea-owner/platform',
          owner: 'gitea-owner',
          name: 'platform',
          origins: [
            {type: 'project', project_id: projectId, project_name: 'Platform'},
            {type: 'manual', grant_id: grant.id},
          ],
        },
      ],
      next_cursor: null,
    });
    expect(listRepositories).not.toHaveBeenCalled();
  });

  it('keeps a project origin visible after deleting the manual origin', async () => {
    const provider = sourceProvider({repositoryAuthorization: 'enforced'});
    const projectId = crypto.randomUUID();
    const listProjectsBySourceConnection = vi.fn(async () => ({
      projects: [
        {
          externalRepositoryId: 'gitea:gitea-owner/platform',
          owner: 'gitea-owner',
          name: 'platform',
          projectId,
          projectName: 'Platform',
        },
      ],
      nextCursor: null,
    }));
    const app = await createTestApp([provider], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();
    const grant = await createGrant(connection.id);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}/repository-grants/${grant.id}`,
      headers: {authorization: 'Bearer user'},
    });
    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
    });

    expect(deleted.statusCode).toBe(204);
    expect(response.statusCode).toBe(200);
    expect(response.json().repositories).toEqual([
      {
        external_repository_id: 'gitea:gitea-owner/platform',
        owner: 'gitea-owner',
        name: 'platform',
        origins: [{type: 'project', project_id: projectId, project_name: 'Platform'}],
      },
    ]);
  });

  it('paginates the composed result by the shared owner, name, and id order', async () => {
    const provider = sourceProvider({repositoryAuthorization: 'enforced'});
    const firstProject = {
      externalRepositoryId: 'gitea:gitea-owner/alpha',
      owner: 'gitea-owner',
      name: 'alpha',
      projectId: crypto.randomUUID(),
      projectName: 'Alpha',
    };
    const secondProject = {
      externalRepositoryId: 'gitea:gitea-owner/gamma',
      owner: 'gitea-owner',
      name: 'gamma',
      projectId: crypto.randomUUID(),
      projectName: 'Gamma',
    };
    const thirdProject = {
      externalRepositoryId: 'gitea:other-owner/delta',
      owner: 'other-owner',
      name: 'delta',
      projectId: crypto.randomUUID(),
      projectName: 'Delta',
    };
    const listProjectsBySourceConnection = vi.fn(
      async (input: Parameters<ProjectsModuleClient['listProjectsBySourceConnection']>[0]) =>
        input.cursor
          ? {projects: [secondProject, thirdProject], nextCursor: null}
          : {
              projects: [firstProject, secondProject],
              nextCursor: {
                owner: secondProject.owner,
                name: secondProject.name,
                externalRepositoryId: secondProject.externalRepositoryId,
              },
            },
    );
    const app = await createTestApp([provider], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();
    await createGrant(connection.id, 'gitea:gitea-owner/beta', 'gitea-owner', 'beta');

    const firstPage = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access?limit=2`,
      headers: {authorization: 'Bearer user'},
    });
    const firstPageJson = firstPage.json();
    const secondPage = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access?limit=2&cursor=${encodeURIComponent(firstPageJson.next_cursor)}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(firstPage.statusCode).toBe(200);
    expect(firstPageJson.repositories.map((repository: {name: string}) => repository.name)).toEqual(
      ['alpha', 'beta'],
    );
    expect(firstPageJson.next_cursor).toBeTruthy();
    expect(secondPage.statusCode).toBe(200);
    expect(
      secondPage.json().repositories.map((repository: {name: string}) => repository.name),
    ).toEqual(['gamma', 'delta']);
    expect(secondPage.json().next_cursor).toBeNull();
    expect(listProjectsBySourceConnection).toHaveBeenNthCalledWith(2, {
      workspaceId: context.workspaceId,
      sourceConnectionId: connection.id,
      limit: 2,
    });
    expect(listProjectsBySourceConnection).toHaveBeenNthCalledWith(3, {
      workspaceId: context.workspaceId,
      sourceConnectionId: connection.id,
      limit: 2,
      cursor: {
        owner: secondProject.owner,
        name: secondProject.name,
        externalRepositoryId: secondProject.externalRepositoryId,
      },
    });
  });

  it('composes all origins before applying the repository cursor', async () => {
    const provider = sourceProvider({repositoryAuthorization: 'enforced'});
    const projectId = crypto.randomUUID();
    const project = {
      externalRepositoryId: 'gitea:shared-repository',
      owner: 'gitea-owner',
      name: 'zeta',
      projectId,
      projectName: 'Shared project',
    };
    const listProjectsBySourceConnection = vi.fn(async () => ({
      projects: [project],
      nextCursor: null,
    }));
    const app = await createTestApp([provider], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();
    const grant = await createGrant(
      connection.id,
      'gitea:shared-repository',
      'gitea-owner',
      'beta',
    );
    const cursor = encodeCursor({
      owner: 'gitea-owner',
      name: 'delta',
      externalRepositoryId: 'gitea:cursor',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access?cursor=${encodeURIComponent(cursor)}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: 'selected',
      repositories: [
        {
          external_repository_id: project.externalRepositoryId,
          owner: project.owner,
          name: project.name,
          origins: [
            {type: 'project', project_id: projectId, project_name: project.projectName},
            {type: 'manual', grant_id: grant.id},
          ],
        },
      ],
      next_cursor: null,
    });
    expect(listProjectsBySourceConnection).toHaveBeenCalledWith({
      workspaceId: context.workspaceId,
      sourceConnectionId: connection.id,
      limit: 50,
    });
  });

  it('keeps an earlier project origin when a manual origin sorts after the cursor', async () => {
    const provider = sourceProvider({repositoryAuthorization: 'enforced'});
    const project = {
      externalRepositoryId: 'gitea:shared-repository',
      owner: 'gitea-owner',
      name: 'alpha',
      projectId: crypto.randomUUID(),
      projectName: 'Shared project',
    };
    const listProjectsBySourceConnection = vi.fn(
      async (input: Parameters<ProjectsModuleClient['listProjectsBySourceConnection']>[0]) =>
        input.cursor ? {projects: [], nextCursor: null} : {projects: [project], nextCursor: null},
    );
    const app = await createTestApp([provider], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();
    const grant = await createGrant(
      connection.id,
      project.externalRepositoryId,
      project.owner,
      'zeta',
    );
    const cursor = encodeCursor({
      owner: project.owner,
      name: 'beta',
      externalRepositoryId: 'gitea:cursor',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access?cursor=${encodeURIComponent(cursor)}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().repositories).toEqual([
      {
        external_repository_id: project.externalRepositoryId,
        owner: project.owner,
        name: 'zeta',
        origins: [
          {type: 'project', project_id: project.projectId, project_name: project.projectName},
          {type: 'manual', grant_id: grant.id},
        ],
      },
    ]);
    expect(listProjectsBySourceConnection).toHaveBeenCalledWith({
      workspaceId: context.workspaceId,
      sourceConnectionId: connection.id,
      limit: 50,
    });
  });

  it('does not repeat a repository when manual metadata sorts after project metadata', async () => {
    const provider = sourceProvider({repositoryAuthorization: 'enforced'});
    const sharedProject = {
      externalRepositoryId: 'gitea:shared-repository',
      owner: 'gitea-owner',
      name: 'alpha',
      projectId: crypto.randomUUID(),
      projectName: 'Shared project',
    };
    const laterProject = {
      externalRepositoryId: 'gitea:gitea-owner/zulu',
      owner: 'gitea-owner',
      name: 'zulu',
      projectId: crypto.randomUUID(),
      projectName: 'Zulu',
    };
    const listProjectsBySourceConnection = vi.fn(
      async (input: Parameters<ProjectsModuleClient['listProjectsBySourceConnection']>[0]) =>
        input.cursor
          ? {projects: [laterProject], nextCursor: null}
          : {
              projects: [sharedProject, laterProject],
              nextCursor: {
                owner: laterProject.owner,
                name: laterProject.name,
                externalRepositoryId: laterProject.externalRepositoryId,
              },
            },
    );
    const app = await createTestApp([provider], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();
    const grant = await createGrant(
      connection.id,
      sharedProject.externalRepositoryId,
      sharedProject.owner,
      'zeta',
    );

    const firstPage = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access?limit=1`,
      headers: {authorization: 'Bearer user'},
    });
    const firstPageJson = firstPage.json();
    const secondPage = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access?limit=1&cursor=${encodeURIComponent(firstPageJson.next_cursor)}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(firstPage.statusCode).toBe(200);
    expect(firstPageJson.repositories).toEqual([
      {
        external_repository_id: sharedProject.externalRepositoryId,
        owner: sharedProject.owner,
        name: 'zeta',
        origins: [
          {
            type: 'project',
            project_id: sharedProject.projectId,
            project_name: sharedProject.projectName,
          },
          {type: 'manual', grant_id: grant.id},
        ],
      },
    ]);
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json().repositories).toEqual([
      {
        external_repository_id: laterProject.externalRepositoryId,
        owner: laterProject.owner,
        name: laterProject.name,
        origins: [
          {
            type: 'project',
            project_id: laterProject.projectId,
            project_name: laterProject.projectName,
          },
        ],
      },
    ]);
  });

  it('keeps project and manual provenance together when their coordinates differ', async () => {
    const provider = sourceProvider({repositoryAuthorization: 'enforced'});
    const sharedProject = {
      externalRepositoryId: 'gitea:shared-repository',
      owner: 'gitea-owner',
      name: 'zeta',
      projectId: crypto.randomUUID(),
      projectName: 'Shared project',
    };
    const laterProject = {
      externalRepositoryId: 'gitea:gitea-owner/zulu',
      owner: 'gitea-owner',
      name: 'zulu',
      projectId: crypto.randomUUID(),
      projectName: 'Zulu',
    };
    const listProjectsBySourceConnection = vi.fn(
      async (input: Parameters<ProjectsModuleClient['listProjectsBySourceConnection']>[0]) =>
        input.cursor
          ? {projects: [laterProject], nextCursor: null}
          : {
              projects: [sharedProject],
              nextCursor: {
                owner: sharedProject.owner,
                name: sharedProject.name,
                externalRepositoryId: sharedProject.externalRepositoryId,
              },
            },
    );
    const app = await createTestApp([provider], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();
    const grant = await createGrant(
      connection.id,
      sharedProject.externalRepositoryId,
      sharedProject.owner,
      'alpha',
    );

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access?limit=1`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().repositories).toEqual([
      {
        external_repository_id: sharedProject.externalRepositoryId,
        owner: sharedProject.owner,
        name: sharedProject.name,
        origins: [
          {
            type: 'project',
            project_id: sharedProject.projectId,
            project_name: sharedProject.projectName,
          },
          {type: 'manual', grant_id: grant.id},
        ],
      },
    ]);
    expect(listProjectsBySourceConnection).toHaveBeenCalledTimes(2);
  });

  it('merges project origins that arrive on different source pages', async () => {
    const provider = sourceProvider({repositoryAuthorization: 'enforced'});
    const externalRepositoryId = 'gitea:shared-repository';
    const firstProject = {
      externalRepositoryId,
      owner: 'gitea-owner',
      name: 'alpha',
      projectId: '00000000-0000-4000-8000-000000000001',
      projectName: 'Alpha project',
    };
    const secondProject = {
      externalRepositoryId,
      owner: 'gitea-owner',
      name: 'zeta',
      projectId: '00000000-0000-4000-8000-000000000002',
      projectName: 'Zeta project',
    };
    const listProjectsBySourceConnection = vi.fn(
      async (input: Parameters<ProjectsModuleClient['listProjectsBySourceConnection']>[0]) =>
        input.cursor
          ? {projects: [secondProject], nextCursor: null}
          : {
              projects: [firstProject],
              nextCursor: {
                owner: firstProject.owner,
                name: firstProject.name,
                externalRepositoryId: firstProject.externalRepositoryId,
              },
            },
    );
    const app = await createTestApp([provider], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access?limit=1`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().repositories).toEqual([
      {
        external_repository_id: externalRepositoryId,
        owner: secondProject.owner,
        name: secondProject.name,
        origins: [
          {
            type: 'project',
            project_id: firstProject.projectId,
            project_name: firstProject.projectName,
          },
          {
            type: 'project',
            project_id: secondProject.projectId,
            project_name: secondProject.projectName,
          },
        ],
      },
    ]);
    expect(listProjectsBySourceConnection).toHaveBeenCalledTimes(2);
  });

  it('fills a short composed page from a subsequent Projects page', async () => {
    const provider = sourceProvider({repositoryAuthorization: 'enforced'});
    const firstProject = {
      externalRepositoryId: 'gitea:gitea-owner/alpha',
      owner: 'gitea-owner',
      name: 'alpha',
      projectId: crypto.randomUUID(),
      projectName: 'Alpha',
    };
    const secondProject = {
      externalRepositoryId: 'gitea:gitea-owner/beta',
      owner: 'gitea-owner',
      name: 'beta',
      projectId: crypto.randomUUID(),
      projectName: 'Beta',
    };
    const listProjectsBySourceConnection = vi.fn(
      async (input: Parameters<ProjectsModuleClient['listProjectsBySourceConnection']>[0]) =>
        input.cursor
          ? {projects: [secondProject], nextCursor: null}
          : {
              projects: [firstProject],
              nextCursor: {
                owner: firstProject.owner,
                name: firstProject.name,
                externalRepositoryId: firstProject.externalRepositoryId,
              },
            },
    );
    const app = await createTestApp([provider], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();
    const grant = await createGrant(
      connection.id,
      firstProject.externalRepositoryId,
      firstProject.owner,
      firstProject.name,
    );

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access?limit=2`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: 'selected',
      repositories: [
        {
          external_repository_id: firstProject.externalRepositoryId,
          origins: [
            {type: 'project', project_id: firstProject.projectId},
            {type: 'manual', grant_id: grant.id},
          ],
        },
        {
          external_repository_id: secondProject.externalRepositoryId,
          origins: [{type: 'project', project_id: secondProject.projectId}],
        },
      ],
      next_cursor: null,
    });
    expect(listProjectsBySourceConnection).toHaveBeenNthCalledWith(2, {
      workspaceId: context.workspaceId,
      sourceConnectionId: connection.id,
      limit: 2,
      cursor: {
        owner: firstProject.owner,
        name: firstProject.name,
        externalRepositoryId: firstProject.externalRepositoryId,
      },
    });
  });

  it('sorts mixed-case repository coordinates consistently across pages', async () => {
    const provider = sourceProvider({repositoryAuthorization: 'enforced'});
    const firstProject = {
      externalRepositoryId: 'gitea:gitea-owner/zeta',
      owner: 'gitea-owner',
      name: 'zeta',
      projectId: crypto.randomUUID(),
      projectName: 'Zeta',
    };
    const secondProject = {
      externalRepositoryId: 'gitea:gitea-owner/alpha',
      owner: 'GITEA-OWNER',
      name: 'alpha.beta',
      projectId: crypto.randomUUID(),
      projectName: 'Alpha',
    };
    const listProjectsBySourceConnection = vi.fn(
      async (input: Parameters<ProjectsModuleClient['listProjectsBySourceConnection']>[0]) =>
        input.cursor
          ? {projects: [secondProject], nextCursor: null}
          : {
              projects: [firstProject],
              nextCursor: {
                owner: firstProject.owner,
                name: firstProject.name,
                externalRepositoryId: firstProject.externalRepositoryId,
              },
            },
    );
    const app = await createTestApp([provider], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access?limit=2`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.json().repositories.map((repository: {name: string}) => repository.name),
    ).toEqual(['alpha.beta', 'zeta']);
  });

  it('merges repeated project origins and removes duplicate origin rows', async () => {
    const provider = sourceProvider({repositoryAuthorization: 'enforced'});
    const externalRepositoryId = 'gitea:gitea-owner/shared';
    const projectA = {
      externalRepositoryId,
      owner: 'gitea-owner',
      name: 'shared',
      projectId: '00000000-0000-4000-8000-000000000001',
      projectName: 'Project A',
    };
    const projectB = {
      ...projectA,
      projectId: '00000000-0000-4000-8000-000000000002',
      projectName: 'Project B',
    };
    const listProjectsBySourceConnection = vi.fn(async () => ({
      projects: [projectA, projectA, projectB],
      nextCursor: null,
    }));
    const app = await createTestApp([provider], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();
    const grant = await createGrant(connection.id, externalRepositoryId, 'gitea-owner', 'shared');

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().repositories).toEqual([
      {
        external_repository_id: externalRepositoryId,
        owner: 'gitea-owner',
        name: 'shared',
        origins: [
          {type: 'project', project_id: projectA.projectId, project_name: projectA.projectName},
          {type: 'project', project_id: projectB.projectId, project_name: projectB.projectName},
          {type: 'manual', grant_id: grant.id},
        ],
      },
    ]);
  });

  it('does not enumerate local targets or providers in all mode', async () => {
    const provider = sourceProvider({repositoryAuthorization: 'enforced'});
    const sourceControl = provider.adapters?.source_control;
    if (!sourceControl) throw new Error('Expected source-control adapter');
    const listRepositories = vi.spyOn(sourceControl, 'listRepositories');
    const listProjectsBySourceConnection = vi.fn(async () => {
      await Promise.resolve();
      throw new Error('all mode must not list projects');
    });
    const app = await createTestApp([provider], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();

    const updated = await app.inject({
      method: 'PUT',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
      payload: {mode: 'all'},
    });
    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
    });

    expect(updated.statusCode).toBe(200);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({mode: 'all', repositories: [], next_cursor: null});
    expect(listProjectsBySourceConnection).not.toHaveBeenCalled();
    expect(listRepositories).not.toHaveBeenCalled();
  });

  it('gates the read route on provider repository-access support', async () => {
    const listProjectsBySourceConnection = vi.fn(async () => {
      await Promise.resolve();
      throw new Error('unsupported provider must not list projects');
    });
    const app = await createTestApp([sourceProvider()], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('integration-repository-access-unsupported');
    expect(listProjectsBySourceConnection).not.toHaveBeenCalled();
  });

  it('returns a coded unavailable error when selected access lacks Projects wiring', async () => {
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})]);
    const connection = await createConnection();

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('projects-module-unavailable');
  });

  it('returns a coded error when Projects pagination does not advance', async () => {
    const stalledCursor = {
      owner: 'gitea-owner',
      name: 'alpha',
      externalRepositoryId: 'gitea:gitea-owner/alpha',
    };
    const listProjectsBySourceConnection = vi.fn(
      async (input: Parameters<ProjectsModuleClient['listProjectsBySourceConnection']>[0]) =>
        input.cursor
          ? {projects: [], nextCursor: stalledCursor}
          : {projects: [], nextCursor: stalledCursor},
    );
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access?limit=2`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe('integration-projects-pagination-failed');
  });

  it('requires workspace-admin access', async () => {
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})], {
      memberships: [
        {
          workspaceId: context.workspaceId,
          role: 'member' as UserContextMembership['role'],
          workspaceStatus: 'active',
        },
      ],
      projects: createProjectsClient(async () => ({projects: [], nextCursor: null})),
    });
    const connection = await createConnection();

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('forbidden');
  });

  it('returns a server error when the local Projects store fails', async () => {
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})], {
      projects: createProjectsClient(async () => {
        await Promise.resolve();
        throw new Error('projects store failed');
      }),
    });
    const connection = await createConnection();

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(500);
  });

  it.each([
    'not-a-cursor',
    Buffer.from(JSON.stringify({owner: 'gitea-owner'}), 'utf8').toString('base64url'),
  ])('rejects malformed cursor %s', async (cursor) => {
    const listProjectsBySourceConnection = vi.fn(async () => ({
      projects: [],
      nextCursor: null,
    }));
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access?cursor=${encodeURIComponent(cursor)}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('invalid-cursor');
    expect(listProjectsBySourceConnection).not.toHaveBeenCalled();
  });

  it('treats an empty cursor as the first page', async () => {
    const listProjectsBySourceConnection = vi.fn(async () => ({
      projects: [],
      nextCursor: null,
    }));
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access?cursor=`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(listProjectsBySourceConnection).toHaveBeenCalledWith({
      workspaceId: context.workspaceId,
      sourceConnectionId: connection.id,
      limit: 50,
    });
  });

  async function createConnection(slug = `gitea_${crypto.randomUUID()}`) {
    return await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: crypto.randomUUID(),
      slug,
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });
  }

  async function createGrant(
    connectionId: string,
    externalRepositoryId = 'gitea:gitea-owner/platform',
    repositoryOwner = 'gitea-owner',
    repositoryName = 'platform',
  ) {
    const grant = await upsertIntegrationConnectionRepositoryGrant({
      connectionId,
      externalRepositoryId,
      repositoryOwner,
      repositoryName,
    });
    if (!grant) throw new Error('Expected repository grant');
    return grant;
  }
});

function createProjectsClient(
  listProjectsBySourceConnection: ProjectsModuleClient['listProjectsBySourceConnection'],
): ProjectsModuleClient {
  return {listProjectsBySourceConnection} as unknown as ProjectsModuleClient;
}

function encodeCursor(cursor: {owner: string; name: string; externalRepositoryId: string}): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
