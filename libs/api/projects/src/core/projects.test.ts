import {sql} from 'drizzle-orm';
import {createVcsConnection, db} from '#db/index.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {createProjectFromRepository} from './projects.js';

describe('createProjectFromRepository', () => {
  let actorId: string;
  let workspaceId: string;

  beforeEach(() => {
    actorId = crypto.randomUUID();
    workspaceId = crypto.randomUUID();
  });

  test('creates a project bound to a repository snapshot', async () => {
    const connection = await createVcsConnection({
      workspaceId,
      provider: 'test',
      providerHost: 'test.local',
      externalConnectionId: 'installation-1',
      displayName: 'Test Installation',
    });

    const project = await createProjectFromRepository({
      actorId,
      workspaceId,
      name: 'Platform',
      vcsConnectionId: connection.id,
      externalRepositoryId: 'platform',
    });

    expect(project.workspaceId).toBe(workspaceId);
    expect(project.name).toBe('Platform');
    expect(project.repository.externalRepositoryId).toBe('platform');
    expect(project.repository.fullName).toBe('test-owner/platform');
    expect(project.repository.metadataFetchedAt).toBeInstanceOf(Date);
  });

  test('emits project lifecycle events in the same transaction', async () => {
    const connection = await createVcsConnection({
      workspaceId,
      provider: 'test',
      providerHost: 'test.local',
      externalConnectionId: 'installation-1',
      displayName: 'Test Installation',
    });

    const project = await createProjectFromRepository({
      actorId,
      workspaceId,
      name: 'Platform',
      vcsConnectionId: connection.id,
      externalRepositoryId: 'platform',
    });

    const events = await db()
      .select()
      .from(projectsOutbox)
      .where(sql`${projectsOutbox.payload}->>'projectId' = ${project.id}`);

    expect(events.map((event) => event.eventType).sort()).toEqual([
      'projects.project.created',
      'projects.project.vcs_bound',
    ]);
  });

  test('rejects a second active project for the same repository in a workspace', async () => {
    const connection = await createVcsConnection({
      workspaceId,
      provider: 'test',
      providerHost: 'test.local',
      externalConnectionId: 'installation-1',
      displayName: 'Test Installation',
    });
    await createProjectFromRepository({
      actorId,
      workspaceId,
      name: 'Platform',
      vcsConnectionId: connection.id,
      externalRepositoryId: 'platform',
    });

    const result = createProjectFromRepository({
      actorId,
      workspaceId,
      name: 'Platform Again',
      vcsConnectionId: connection.id,
      externalRepositoryId: 'platform',
    });

    await expect(result).rejects.toThrow('Project already exists');
  });

  test('surfaces provider repository access failures', async () => {
    const connection = await createVcsConnection({
      workspaceId,
      provider: 'test',
      providerHost: 'test.local',
      externalConnectionId: 'installation-1',
      displayName: 'Test Installation',
    });

    const result = createProjectFromRepository({
      actorId,
      workspaceId,
      name: 'Missing',
      vcsConnectionId: connection.id,
      externalRepositoryId: 'not-found',
    });

    await expect(result).rejects.toMatchObject({reason: 'repository-not-found'});
  });
});
