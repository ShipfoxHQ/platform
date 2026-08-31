import {eq} from 'drizzle-orm';
import {projectFactory} from '#test/index.js';
import {db} from './db.js';
import {
  findProjectBySourceRepositoryName,
  getProjectById,
  getProjectCount,
  getWorkspaceProjectCounts,
  updateProject,
} from './projects.js';
import {projects} from './schema/projects.js';

describe('findProjectBySourceRepositoryName', () => {
  it('returns all case-insensitive matches scoped by workspace and connection', async () => {
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();

    const emptyMatches = await findProjectBySourceRepositoryName({
      workspaceId,
      connectionId,
      owner: 'acme',
      name: 'api',
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
      connectionId,
      owner: 'ACME',
      name: 'aPI',
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
      connectionId,
      owner: 'AcMe',
      name: 'API',
    });

    expect(multipleMatches).toHaveLength(2);
    expect(multipleMatches.map(({id}) => id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
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
