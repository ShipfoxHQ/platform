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

  test('lists project repositories by source connection through the producer contract', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const first = await insertProject({
      workspaceId,
      connectionId,
      owner: 'AcMe',
      name: 'Api',
      externalRepositoryId: 'github:1',
    });
    const second = await insertProject({
      workspaceId,
      connectionId,
      owner: 'acme',
      name: 'api',
      externalRepositoryId: 'github:2',
    });
    await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'excluded',
      externalRepositoryId: 'github:3',
    });

    const firstPage = await client.listProjectsBySourceConnection({
      workspaceId,
      sourceConnectionId: connectionId,
      limit: 1,
    });

    expect(firstPage.projects).toEqual([
      {
        externalRepositoryId: 'github:1',
        owner: 'AcMe',
        name: 'Api',
        projectId: first.projectId,
        projectName: 'Api',
      },
    ]);
    expect(firstPage.nextCursor).toEqual({
      owner: 'AcMe',
      name: 'Api',
      externalRepositoryId: 'github:1',
    });

    const secondPage = await client.listProjectsBySourceConnection({
      workspaceId,
      sourceConnectionId: connectionId,
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(secondPage.projects).toEqual([
      {
        externalRepositoryId: 'github:2',
        owner: 'acme',
        name: 'api',
        projectId: second.projectId,
        projectName: 'api',
      },
    ]);
    expect(secondPage.nextCursor).toBeNull();
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
      target: {project: project.projectId},
    });
  });
});
