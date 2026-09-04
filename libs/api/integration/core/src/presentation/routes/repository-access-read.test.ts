import type {UserContextMembership} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {vi} from '@shipfox/vitest/vi';
import {upsertIntegrationConnection} from '#db/connections.js';
import {createRepositoryAuthorizer} from '#index.js';
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

  it('returns project-backed repositories after persisting selected mode', async () => {
    const projectId = crypto.randomUUID();
    const listProjectsBySourceConnection = vi.fn(async () => ({
      projects: [
        {
          externalRepositoryId: 'gitea:gitea-owner/platform',
          owner: 'gitea-owner',
          name: 'platform',
          projectId,
          projectName: 'Platform',
          projectSlug: 'platform',
        },
      ],
      nextCursor: null,
    }));
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();

    const allResponse = await app.inject({
      method: 'PUT',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
      payload: {mode: 'all'},
    });
    const selectedResponse = await app.inject({
      method: 'PUT',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
      payload: {mode: 'selected'},
    });
    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
    });

    expect(allResponse.statusCode).toBe(200);
    expect(selectedResponse.statusCode).toBe(200);
    expect(selectedResponse.json()).toEqual({mode: 'selected'});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: 'selected',
      repositories: [
        {
          external_repository_id: 'gitea:gitea-owner/platform',
          owner: 'gitea-owner',
          name: 'platform',
          project_id: projectId,
          project_name: 'Platform',
          project_slug: 'platform',
        },
      ],
      next_cursor: null,
    });
  });

  it('forwards and returns the Projects cursor', async () => {
    const cursor = {
      owner: 'gitea-owner',
      name: 'platform',
      externalRepositoryId: 'gitea:gitea-owner/platform',
    };
    const nextCursor = {
      owner: 'other-owner',
      name: 'service',
      externalRepositoryId: 'gitea:other-owner/service',
    };
    const listProjectsBySourceConnection = vi.fn(async () => ({
      projects: [],
      nextCursor,
    }));
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})], {
      projects: createProjectsClient(listProjectsBySourceConnection),
    });
    const connection = await createConnection();

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access?limit=10&cursor=${encodeURIComponent(encodeCursor(cursor))}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().next_cursor).toBe(encodeCursor(nextCursor));
    expect(listProjectsBySourceConnection).toHaveBeenCalledWith({
      workspaceId: context.workspaceId,
      sourceConnectionId: connection.id,
      limit: 10,
      cursor,
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
    const listProjectsBySourceConnection = vi.fn(async () => ({projects: [], nextCursor: null}));
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

  it('returns a coded unavailable error without Projects wiring', async () => {
    const app = await createTestApp([sourceProvider({repositoryAuthorization: 'enforced'})], {
      omitProjects: true,
      repositoryAuthorizer: createRepositoryAuthorizer({enabled: false}),
    });
    const connection = await createConnection();

    const response = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repository-access`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('projects-module-unavailable');
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
    const listProjectsBySourceConnection = vi.fn(async () => ({projects: [], nextCursor: null}));
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
    const listProjectsBySourceConnection = vi.fn(async () => ({projects: [], nextCursor: null}));
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

  async function createConnection() {
    return await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: crypto.randomUUID(),
      slug: `gitea_${crypto.randomUUID()}`,
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });
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
