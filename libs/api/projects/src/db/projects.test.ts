import {eq} from 'drizzle-orm';
import {projectFactory} from '#test/index.js';
import {db} from './db.js';
import {
  getProjectById,
  getProjectCount,
  getWorkspaceProjectCounts,
  updateProject,
} from './projects.js';
import {projects} from './schema/projects.js';

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
