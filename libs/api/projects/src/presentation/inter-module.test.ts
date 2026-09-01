import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {db} from '#db/index.js';
import {projects} from '#db/schema/projects.js';
import {createProjectsInterModulePresentation} from './inter-module.js';

function createClient() {
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(projectsInterModuleContract);
  transport.register(createProjectsInterModulePresentation());
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

  test('lists workspace projects with catalog fields through the catalog contract', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const project = await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'api',
    });

    const result = await client.listProjectCatalogByWorkspace({workspaceId, limit: 10});

    expect(result.nextCursor).toBeNull();
    expect(result.projects).toEqual([
      expect.objectContaining({
        id: project.projectId,
        slug: expect.any(String),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    ]);
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

  test('finds zero, one, and multiple source repository name matches', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();

    await expect(
      client.findProjectBySourceRepositoryName({
        workspaceId,
        sourceConnectionId: connectionId,
        sourceRepositoryOwner: 'acme',
        sourceRepositoryName: 'api',
      }),
    ).resolves.toEqual({projects: []});

    const first = await insertProject({
      workspaceId,
      connectionId,
      owner: 'AcMe',
      name: 'Api',
      externalRepositoryId: 'github:one',
    });
    await insertProject({
      workspaceId: crypto.randomUUID(),
      connectionId,
      owner: 'acme',
      name: 'api',
      externalRepositoryId: 'github:other-workspace',
    });
    await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'api',
      externalRepositoryId: 'github:other-connection',
    });

    await expect(
      client.findProjectBySourceRepositoryName({
        workspaceId,
        sourceConnectionId: connectionId,
        sourceRepositoryOwner: 'ACME',
        sourceRepositoryName: 'aPI',
      }),
    ).resolves.toMatchObject({
      projects: [
        {
          id: first.projectId,
          sourceConnectionId: connectionId,
          sourceExternalRepositoryId: 'github:one',
          sourceRepositoryOwner: 'AcMe',
          sourceRepositoryName: 'Api',
        },
      ],
    });

    const second = await insertProject({
      workspaceId,
      connectionId,
      owner: 'acme',
      name: 'api',
      externalRepositoryId: 'github:two',
    });

    const multipleMatches = await client.findProjectBySourceRepositoryName({
      workspaceId,
      sourceConnectionId: connectionId,
      sourceRepositoryOwner: 'AcMe',
      sourceRepositoryName: 'API',
    });

    expect(multipleMatches.projects).toHaveLength(2);
    expect(multipleMatches.projects.map(({id}) => id)).toEqual([first.projectId, second.projectId]);
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
    ).resolves.toEqual({
      projectId: project.projectId,
      connectionId: project.connectionId,
      target: {
        kind: 'external-id',
        externalRepositoryId: project.externalRepositoryId,
      },
    });
  });

  test('resolves a bare repository name against the default owner', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    await insertProject({
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
    ).resolves.toEqual({
      connectionId,
      target: {kind: 'name', owner: 'acme', name: 'api'},
    });
  });

  test('resolves an owner/name repository case-insensitively', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    await insertProject({
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
    ).resolves.toEqual({
      connectionId,
      target: {kind: 'name', owner: 'aCmE', name: 'aPI'},
    });
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
    await insertProject({
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
    ).resolves.toEqual({
      connectionId: explicitConnectionId,
      target: {kind: 'name', owner: 'acme', name: 'api'},
    });
  });

  test('preserves an owner/name target without deciding authorization', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    await insertProject({workspaceId, connectionId, owner: 'acme', name: 'api'});
    await insertProject({workspaceId, connectionId, owner: 'acme', name: 'api'});

    await expect(
      client.resolveCheckoutTarget({
        workspaceId,
        defaults: {connectionId, owner: 'acme'},
        target: {repository: 'acme/api'},
      }),
    ).resolves.toEqual({
      connectionId,
      target: {kind: 'name', owner: 'acme', name: 'api'},
    });
  });

  test('does not decide authorization for a bare repository name', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    await insertProject({
      workspaceId,
      connectionId,
      owner: 'other',
      name: 'api',
    });

    await expect(
      client.resolveCheckoutTarget({
        workspaceId,
        defaults: {connectionId, owner: 'acme'},
        target: {repository: 'api'},
      }),
    ).resolves.toEqual({
      connectionId,
      target: {kind: 'name', owner: 'acme', name: 'api'},
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
