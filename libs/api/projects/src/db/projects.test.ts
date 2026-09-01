import {eq} from 'drizzle-orm';
import {projectFactory} from '#test/index.js';
import {db} from './db.js';
import {
  findProjectBySourceRepositoryName,
  getProjectById,
  getProjectCount,
  getWorkspaceProjectCounts,
  listProjectsBySourceConnection,
  updateProject,
} from './projects.js';
import {projects} from './schema/projects.js';

async function insertSourceRepositoryProject(params: {
  workspaceId: string;
  sourceConnectionId: string;
  sourceRepositoryOwner: string | null;
  sourceRepositoryName: string | null;
  sourceExternalRepositoryId: string;
  name?: string;
}) {
  const [project] = await db()
    .insert(projects)
    .values({
      workspaceId: params.workspaceId,
      sourceConnectionId: params.sourceConnectionId,
      sourceExternalRepositoryId: params.sourceExternalRepositoryId,
      sourceRepositoryOwner: params.sourceRepositoryOwner,
      sourceRepositoryName: params.sourceRepositoryName,
      name: params.name ?? 'Project',
      slug: `project-${crypto.randomUUID()}`,
    })
    .returning({id: projects.id});

  if (!project) throw new Error('Project insert returned no row');
  return project.id;
}

describe('listProjectsBySourceConnection', () => {
  it('returns an empty page when no project repository matches', async () => {
    const result = await listProjectsBySourceConnection({
      workspaceId: crypto.randomUUID(),
      sourceConnectionId: crypto.randomUUID(),
      limit: 10,
    });

    expect(result).toEqual({projects: [], nextCursor: null});
  });

  it('returns a single project repository with its project details', async () => {
    const workspaceId = crypto.randomUUID();
    const sourceConnectionId = crypto.randomUUID();
    const projectId = await insertSourceRepositoryProject({
      workspaceId,
      sourceConnectionId,
      sourceRepositoryOwner: 'Acme',
      sourceRepositoryName: 'API',
      sourceExternalRepositoryId: 'github:1',
      name: 'API project',
    });

    const result = await listProjectsBySourceConnection({
      workspaceId,
      sourceConnectionId,
      limit: 10,
    });

    expect(result).toEqual({
      projects: [
        {
          sourceExternalRepositoryId: 'github:1',
          sourceRepositoryOwner: 'Acme',
          sourceRepositoryName: 'API',
          projectId,
          projectName: 'API project',
        },
      ],
      nextCursor: null,
    });
  });

  it('paginates only the scoped project repositories', async () => {
    const workspaceId = crypto.randomUUID();
    const sourceConnectionId = crypto.randomUUID();
    const firstId = await insertSourceRepositoryProject({
      workspaceId,
      sourceConnectionId,
      sourceRepositoryOwner: 'acme',
      sourceRepositoryName: 'one',
      sourceExternalRepositoryId: 'github:1',
    });
    const secondId = await insertSourceRepositoryProject({
      workspaceId,
      sourceConnectionId,
      sourceRepositoryOwner: 'acme',
      sourceRepositoryName: 'two',
      sourceExternalRepositoryId: 'github:2',
    });
    const thirdId = await insertSourceRepositoryProject({
      workspaceId,
      sourceConnectionId,
      sourceRepositoryOwner: 'other',
      sourceRepositoryName: 'three',
      sourceExternalRepositoryId: 'github:3',
    });
    await insertSourceRepositoryProject({
      workspaceId: crypto.randomUUID(),
      sourceConnectionId,
      sourceRepositoryOwner: 'acme',
      sourceRepositoryName: 'outside-workspace',
      sourceExternalRepositoryId: 'github:4',
    });
    await insertSourceRepositoryProject({
      workspaceId,
      sourceConnectionId: crypto.randomUUID(),
      sourceRepositoryOwner: 'acme',
      sourceRepositoryName: 'outside-connection',
      sourceExternalRepositoryId: 'github:5',
    });

    const firstPage = await listProjectsBySourceConnection({
      workspaceId,
      sourceConnectionId,
      limit: 2,
    });

    expect(firstPage.projects.map(({projectId}) => projectId)).toEqual([firstId, secondId]);
    expect(firstPage.nextCursor).toEqual({
      sourceRepositoryOwner: 'acme',
      sourceRepositoryName: 'two',
      sourceExternalRepositoryId: 'github:2',
    });

    const secondPage = await listProjectsBySourceConnection({
      workspaceId,
      sourceConnectionId,
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(secondPage.projects.map(({projectId}) => projectId)).toEqual([thirdId]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('orders equal folded owner and repository names by external repository id', async () => {
    const workspaceId = crypto.randomUUID();
    const sourceConnectionId = crypto.randomUUID();
    await insertSourceRepositoryProject({
      workspaceId,
      sourceConnectionId,
      sourceRepositoryOwner: 'AcMe',
      sourceRepositoryName: 'Api',
      sourceExternalRepositoryId: 'github:2',
    });
    await insertSourceRepositoryProject({
      workspaceId,
      sourceConnectionId,
      sourceRepositoryOwner: 'acme',
      sourceRepositoryName: 'api',
      sourceExternalRepositoryId: 'github:1',
    });
    await insertSourceRepositoryProject({
      workspaceId,
      sourceConnectionId,
      sourceRepositoryOwner: 'ACME',
      sourceRepositoryName: 'API',
      sourceExternalRepositoryId: 'github:3',
    });

    const firstPage = await listProjectsBySourceConnection({
      workspaceId,
      sourceConnectionId,
      limit: 1,
    });
    const secondPage = await listProjectsBySourceConnection({
      workspaceId,
      sourceConnectionId,
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    });
    const thirdPage = await listProjectsBySourceConnection({
      workspaceId,
      sourceConnectionId,
      limit: 1,
      cursor: secondPage.nextCursor ?? undefined,
    });

    expect(
      [firstPage, secondPage, thirdPage].flatMap((page) =>
        page.projects.map(({sourceExternalRepositoryId}) => sourceExternalRepositoryId),
      ),
    ).toEqual(['github:1', 'github:2', 'github:3']);
    expect(thirdPage.nextCursor).toBeNull();
  });

  it('excludes project rows without repository owner or name metadata', async () => {
    const workspaceId = crypto.randomUUID();
    const sourceConnectionId = crypto.randomUUID();
    await insertSourceRepositoryProject({
      workspaceId,
      sourceConnectionId,
      sourceRepositoryOwner: 'acme',
      sourceRepositoryName: null,
      sourceExternalRepositoryId: 'github:missing-name',
    });
    await insertSourceRepositoryProject({
      workspaceId,
      sourceConnectionId,
      sourceRepositoryOwner: null,
      sourceRepositoryName: 'api',
      sourceExternalRepositoryId: 'github:missing-owner',
    });
    await insertSourceRepositoryProject({
      workspaceId,
      sourceConnectionId,
      sourceRepositoryOwner: '',
      sourceRepositoryName: 'api',
      sourceExternalRepositoryId: 'github:empty-owner',
    });
    await insertSourceRepositoryProject({
      workspaceId,
      sourceConnectionId,
      sourceRepositoryOwner: 'acme',
      sourceRepositoryName: '',
      sourceExternalRepositoryId: 'github:empty-name',
    });

    await expect(
      listProjectsBySourceConnection({workspaceId, sourceConnectionId, limit: 10}),
    ).resolves.toEqual({projects: [], nextCursor: null});
  });

  it('does not return a cursor when matching rows equal the limit', async () => {
    const workspaceId = crypto.randomUUID();
    const sourceConnectionId = crypto.randomUUID();
    await insertSourceRepositoryProject({
      workspaceId,
      sourceConnectionId,
      sourceRepositoryOwner: 'acme',
      sourceRepositoryName: 'one',
      sourceExternalRepositoryId: 'github:1',
    });
    await insertSourceRepositoryProject({
      workspaceId,
      sourceConnectionId,
      sourceRepositoryOwner: 'acme',
      sourceRepositoryName: 'two',
      sourceExternalRepositoryId: 'github:2',
    });

    const result = await listProjectsBySourceConnection({
      workspaceId,
      sourceConnectionId,
      limit: 2,
    });

    expect(result.projects).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });
});

describe('findProjectBySourceRepositoryName', () => {
  it('returns all case-insensitive matches scoped by workspace and connection', async () => {
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();

    const emptyMatches = await findProjectBySourceRepositoryName({
      workspaceId,
      sourceConnectionId: connectionId,
      sourceRepositoryOwner: 'acme',
      sourceRepositoryName: 'api',
    });

    expect(emptyMatches).toEqual([]);

    const [first] = await db()
      .insert(projects)
      .values({
        workspaceId,
        sourceConnectionId: connectionId,
        sourceExternalRepositoryId: 'github:one',
        sourceRepositoryOwner: 'AcMe',
        sourceRepositoryName: 'Api',
        name: 'First project',
        slug: `first-${crypto.randomUUID()}`,
      })
      .returning({id: projects.id});
    if (!first) throw new Error('First project insert returned no row');

    const [missingName] = await db()
      .insert(projects)
      .values({
        workspaceId,
        sourceConnectionId: connectionId,
        sourceExternalRepositoryId: 'github:missing-name',
        sourceRepositoryOwner: 'acme',
        sourceRepositoryName: null,
        name: 'Missing repository name',
        slug: `missing-name-${crypto.randomUUID()}`,
      })
      .returning({id: projects.id});
    if (!missingName) throw new Error('Missing-name project insert returned no row');

    await db()
      .insert(projects)
      .values({
        workspaceId: crypto.randomUUID(),
        sourceConnectionId: connectionId,
        sourceExternalRepositoryId: 'github:other-workspace',
        sourceRepositoryOwner: 'acme',
        sourceRepositoryName: 'api',
        name: 'Other workspace project',
        slug: `other-workspace-${crypto.randomUUID()}`,
      });
    await db()
      .insert(projects)
      .values({
        workspaceId,
        sourceConnectionId: crypto.randomUUID(),
        sourceExternalRepositoryId: 'github:other-connection',
        sourceRepositoryOwner: 'acme',
        sourceRepositoryName: 'api',
        name: 'Other connection project',
        slug: `other-connection-${crypto.randomUUID()}`,
      });

    const oneMatch = await findProjectBySourceRepositoryName({
      workspaceId,
      sourceConnectionId: connectionId,
      sourceRepositoryOwner: 'ACME',
      sourceRepositoryName: 'aPI',
    });

    expect(oneMatch).toHaveLength(1);
    expect(oneMatch[0]).toMatchObject({
      id: first.id,
      workspaceId,
      sourceConnectionId: connectionId,
      sourceExternalRepositoryId: 'github:one',
      sourceRepositoryOwner: 'AcMe',
      sourceRepositoryName: 'Api',
    });
    expect(oneMatch.map(({id}) => id)).not.toContain(missingName.id);

    const [second] = await db()
      .insert(projects)
      .values({
        workspaceId,
        sourceConnectionId: connectionId,
        sourceExternalRepositoryId: 'github:two',
        sourceRepositoryOwner: 'acme',
        sourceRepositoryName: 'api',
        name: 'Second project',
        slug: `second-${crypto.randomUUID()}`,
      })
      .returning({id: projects.id});
    if (!second) throw new Error('Second project insert returned no row');

    const multipleMatches = await findProjectBySourceRepositoryName({
      workspaceId,
      sourceConnectionId: connectionId,
      sourceRepositoryOwner: 'AcMe',
      sourceRepositoryName: 'API',
    });

    expect(multipleMatches).toHaveLength(2);
    expect(multipleMatches.map(({id}) => id)).toEqual([first.id, second.id]);
  });
});

describe('getProjectCount', () => {
  it('reports the current project count', async () => {
    const before = await getProjectCount();

    const after = await getProjectCount();

    expect(after - before).toBe(0);
  });

  it('counts newly created projects', async () => {
    const before = await getProjectCount();
    await projectFactory.create();
    await projectFactory.create();

    const after = await getProjectCount();

    expect(after - before).toBe(2);
  });

  it('returns zero for workspaces without projects', async () => {
    const workspaceId = crypto.randomUUID();

    const counts = await getWorkspaceProjectCounts({workspaceIds: [workspaceId]});

    expect(counts).toEqual([{workspaceId, count: 0}]);
  });
});

describe('updateProject', () => {
  it('preserves a concurrent update to fields omitted from a partial update', async () => {
    const project = await projectFactory.create();
    let allowStaleTransactionUpdate!: () => void;
    let staleTransactionRead!: () => void;
    const staleTransactionCanUpdate = new Promise<void>((resolve) => {
      allowStaleTransactionUpdate = resolve;
    });
    const staleTransactionHasRead = new Promise<void>((resolve) => {
      staleTransactionRead = resolve;
    });

    const staleTransaction = db().transaction(async (tx) => {
      await tx.select({id: projects.id}).from(projects).where(eq(projects.id, project.id)).limit(1);
      staleTransactionRead();
      await staleTransactionCanUpdate;
      return updateProject({projectId: project.id, slug: 'stale-slug-update'}, {tx});
    });

    await staleTransactionHasRead;
    try {
      await updateProject({projectId: project.id, name: 'Concurrent name'});
    } finally {
      allowStaleTransactionUpdate();
    }
    await staleTransaction;

    const finalProject = await getProjectById(project.id);
    expect(finalProject).toMatchObject({
      name: 'Concurrent name',
      slug: 'stale-slug-update',
    });
  });
});
