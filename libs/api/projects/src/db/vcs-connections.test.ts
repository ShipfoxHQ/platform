import {createVcsConnection, getVcsConnectionById} from './vcs-connections.js';

describe('vcs connection queries', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  test('creates and loads a VCS connection', async () => {
    const connection = await createVcsConnection({
      workspaceId,
      provider: 'test',
      providerHost: 'test.local',
      externalConnectionId: 'installation-1',
      displayName: 'Test Installation',
    });

    const found = await getVcsConnectionById(connection.id);

    expect(found?.workspaceId).toBe(workspaceId);
    expect(found?.provider).toBe('test');
    expect(found?.displayName).toBe('Test Installation');
  });

  test('upserts the same workspace/provider/external connection', async () => {
    const first = await createVcsConnection({
      workspaceId,
      provider: 'test',
      providerHost: 'test.local',
      externalConnectionId: 'installation-1',
      displayName: 'Original Name',
    });

    const second = await createVcsConnection({
      workspaceId,
      provider: 'test',
      providerHost: 'test.local',
      externalConnectionId: 'installation-1',
      displayName: 'Updated Name',
    });

    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe('Updated Name');
  });
});
