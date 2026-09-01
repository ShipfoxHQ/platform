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
      cursor: {
        owner: 'gitea-owner',
        name: 'beta',
        externalRepositoryId: 'gitea:gitea-owner/beta',
      },
    });
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
