import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {db} from '#db/index.js';
import {projects} from '#db/schema/projects.js';
import {createProjectsInterModulePresentation} from './inter-module.js';

function createClient(
  integrations: Pick<IntegrationsModuleClient, 'resolveSourceRepository'> = {
    resolveSourceRepository: vi.fn(async ({connectionId, externalRepositoryId}) => ({
      connection: {id: connectionId, provider: 'github', slug: 'github'},
      repository: {
        externalRepositoryId,
        owner: 'acme',
        name: 'api',
        fullName: 'acme/api',
        defaultBranch: 'main',
        visibility: 'private' as const,
        cloneUrl: 'https://github.com/acme/api.git',
        htmlUrl: 'https://github.com/acme/api',
      },
    })),
  },
) {
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(projectsInterModuleContract);
  transport.register(createProjectsInterModulePresentation({integrations}));
  transport.seal();
  return client;
}

async function insertProject(params: {
  workspaceId: string;
  connectionId: string;
  owner: string | null;
  name: string | null;
  externalRepositoryId?: string;
}) {
  const [project] = await db()
    .insert(projects)
    .values({
      workspaceId: params.workspaceId,
      sourceConnectionId: params.connectionId,
      sourceExternalRepositoryId:
        params.externalRepositoryId ?? `repository-${crypto.randomUUID()}`,
      sourceRepositoryOwner: params.owner,
      sourceRepositoryName: params.name,
      name: params.name ?? 'Project',
      slug: `p-${crypto.randomUUID().slice(0, 8)}`,
    })
    .returning({
      projectId: projects.id,
      connectionId: projects.sourceConnectionId,
      externalRepositoryId: projects.sourceExternalRepositoryId,
    });

  if (project === undefined) throw new Error('Project insert returned no row');
  return project;
}

async function expectUnauthorized(
  client: ReturnType<typeof createClient>,
  input: Parameters<typeof client.resolveCheckoutTarget>[0],
) {
  const error = await client.resolveCheckoutTarget(input).catch((caught) => caught);

  expect(
    isInterModuleKnownError(projectsInterModuleContract.methods.resolveCheckoutTarget, error),
  ).toBe(true);
  if (isInterModuleKnownError(projectsInterModuleContract.methods.resolveCheckoutTarget, error)) {
    expect(error.code).toBe('checkout-repository-not-authorized');
    expect(error.details).toEqual({});
  }
}

describe('Projects checkout target inter-module presentation', () => {
  test('lists workspace projects through the paginated inter-module contract', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const first = await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'first',
    });
    const second = await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'second',
    });
    await insertProject({
      workspaceId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      owner: 'other',
      name: 'excluded',
    });

    const firstPage = await client.listProjectsByWorkspace({workspaceId, limit: 1});
    expect(firstPage.projects).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    if (!firstPage.nextCursor) expect.fail('Expected a second project page');

    const secondPage = await client.listProjectsByWorkspace({
      workspaceId,
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.projects).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    const projectIds = [...firstPage.projects, ...secondPage.projects]
      .map((project) => project.id)
      .sort();
    expect(projectIds).toEqual([first.projectId, second.projectId].sort());
  });

  test('resolves a project by its workspace-scoped source repository', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const project = await insertProject({
      workspaceId,
      connectionId,
      owner: 'acme',
      name: 'api',
      externalRepositoryId: 'github:42',
    });

    await expect(
      client.getProjectBySource({
        workspaceId,
        sourceConnectionId: connectionId,
        sourceExternalRepositoryId: project.externalRepositoryId,
      }),
    ).resolves.toMatchObject({project: {id: project.projectId}});

    await expect(
      client.getProjectBySource({
        workspaceId: crypto.randomUUID(),
        sourceConnectionId: connectionId,
        sourceExternalRepositoryId: project.externalRepositoryId,
      }),
    ).resolves.toEqual({project: null});
  });

  test('resolves a project target in its workspace', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const project = await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'api',
    });

    await expect(
      client.resolveCheckoutTarget({
        workspaceId,
        defaults: {connectionId: crypto.randomUUID(), owner: 'other'},
        target: {project: project.projectId},
      }),
    ).resolves.toEqual(project);
  });

  test('resolves a bare repository name against the default owner', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const project = await insertProject({
      workspaceId,
      connectionId,
      owner: 'AcMe',
      name: 'Api',
    });

    await expect(
      client.resolveCheckoutTarget({
        workspaceId,
        defaults: {connectionId, owner: 'acme'},
        target: {repository: 'api'},
      }),
    ).resolves.toEqual(project);
  });

  test('resolves an owner/name repository case-insensitively', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const project = await insertProject({
      workspaceId,
      connectionId,
      owner: 'AcMe',
      name: 'Api',
    });

    await expect(
      client.resolveCheckoutTarget({
        workspaceId,
        defaults: {connectionId, owner: 'other'},
        target: {repository: 'aCmE/aPI'},
      }),
    ).resolves.toEqual(project);
  });

  test('uses an explicit connection to select between identical repositories', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const defaultConnectionId = crypto.randomUUID();
    const explicitConnectionId = crypto.randomUUID();
    await insertProject({
      workspaceId,
      connectionId: defaultConnectionId,
      owner: 'acme',
      name: 'api',
    });
    const explicitProject = await insertProject({
      workspaceId,
      connectionId: explicitConnectionId,
      owner: 'acme',
      name: 'api',
    });

    await expect(
      client.resolveCheckoutTarget({
        workspaceId,
        defaults: {connectionId: defaultConnectionId, owner: 'acme'},
        target: {connection: explicitConnectionId, repository: 'acme/api'},
      }),
    ).resolves.toEqual(explicitProject);
  });

  test('rejects an ambiguous owner/name match instead of picking arbitrarily', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    await insertProject({workspaceId, connectionId, owner: 'acme', name: 'api'});
    await insertProject({workspaceId, connectionId, owner: 'acme', name: 'api'});

    await expectUnauthorized(client, {
      workspaceId,
      defaults: {connectionId, owner: 'acme'},
      target: {repository: 'acme/api'},
    });
  });

  test('refreshes provider metadata before resolving a repository name', async () => {
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const externalRepositoryId = `github:${crypto.randomUUID()}`;
    const resolveSourceRepository = vi.fn(async () => ({
      connection: {id: connectionId, provider: 'github', slug: 'github'},
      repository: {
        externalRepositoryId,
        owner: 'acme',
        name: 'new-name',
        fullName: 'acme/new-name',
        defaultBranch: 'main',
        visibility: 'private' as const,
        cloneUrl: 'https://github.com/acme/new-name.git',
        htmlUrl: 'https://github.com/acme/new-name',
      },
    }));
    const client = createClient({resolveSourceRepository});
    const project = await insertProject({
      workspaceId,
      connectionId,
      owner: 'acme',
      name: 'old-name',
      externalRepositoryId,
    });

    await expectUnauthorized(client, {
      workspaceId,
      defaults: {connectionId, owner: 'acme'},
      target: {repository: 'acme/old-name'},
    });

    await expect(
      client.resolveCheckoutTarget({
        workspaceId,
        defaults: {connectionId, owner: 'acme'},
        target: {repository: 'acme/new-name'},
      }),
    ).resolves.toEqual(project);
    expect(resolveSourceRepository).toHaveBeenCalledWith({
      workspaceId,
      connectionId,
      externalRepositoryId: project.externalRepositoryId,
    });
  });

  test('does not let a bare name escape the default owner', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    await insertProject({
      workspaceId,
      connectionId,
      owner: 'other',
      name: 'api',
    });

    await expectUnauthorized(client, {
      workspaceId,
      defaults: {connectionId, owner: 'acme'},
      target: {repository: 'api'},
    });
  });

  test('rejects a project from another workspace', async () => {
    const client = createClient();
    const project = await insertProject({
      workspaceId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'api',
    });

    await expectUnauthorized(client, {
      workspaceId: crypto.randomUUID(),
      defaults: {connectionId: project.connectionId, owner: 'acme'},
      target: {project: project.projectId},
    });
  });

  test.each([
    ['an unknown target', {repository: 'acme/missing'}],
    ['a leading slash', {repository: '/api'}],
    ['a trailing slash', {repository: 'acme/'}],
    ['more than one slash', {repository: 'acme/api/extra'}],
  ])('rejects %s', async (_label, target) => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    await insertProject({
      workspaceId,
      connectionId,
      owner: 'acme',
      name: 'new-name',
    });

    await expectUnauthorized(client, {
      workspaceId,
      defaults: {connectionId, owner: 'acme'},
      target,
    });
  });
});
