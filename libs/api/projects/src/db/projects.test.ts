import {projectFactory} from '#test/index.js';
import {getProjectCount, getWorkspaceProjectCounts} from './projects.js';

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
