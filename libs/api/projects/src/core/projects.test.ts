import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {sql} from 'drizzle-orm';
import {db} from '#db/index.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {createProjectFromSource} from './projects.js';

describe('createProjectFromSource', () => {
  let actorId: string;
  let workspaceId: string;
  let sourceConnectionId: string;
  let integrations: Pick<IntegrationsModuleClient, 'resolveSourceRepository'>;

  beforeEach(() => {
    actorId = crypto.randomUUID();
    workspaceId = crypto.randomUUID();
    sourceConnectionId = crypto.randomUUID();
    integrations = {
      resolveSourceRepository: vi.fn(async () => {
        await Promise.resolve();
        return {
          connection: {
            id: sourceConnectionId,
            provider: 'gitea' as const,
            slug: 'gitea_owner',
          },
          repository: {
            externalRepositoryId: 'gitea:gitea-owner/platform',
            owner: 'gitea-owner',
            name: 'platform',
            fullName: 'gitea-owner/platform',
            defaultBranch: 'main',
            visibility: 'private' as const,
            cloneUrl: 'https://gitea.local/gitea-owner/platform.git',
            htmlUrl: 'https://gitea.local/gitea-owner/platform',
          },
        };
      }),
    };
  });

  test('creates a project bound to a source repository', async () => {
    const project = await createProjectFromSource({
      actorId,
      workspaceId,
      name: 'Platform',
      slug: 'platform',
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      integrations: integrations as IntegrationsModuleClient,
    });

    expect(project.workspaceId).toBe(workspaceId);
    expect(project.name).toBe('Platform');
    expect(project.slug).toBe('platform');
    expect(project.sourceConnectionId).toBe(sourceConnectionId);
    expect(project.sourceExternalRepositoryId).toBe('gitea:gitea-owner/platform');
    expect(project.sourceRepositoryOwner).toBe('gitea-owner');
    expect(project.sourceRepositoryName).toBe('platform');
    expect(project.sourceDefaultBranch).toBe('main');
  });

  test('emits project lifecycle events in the same transaction', async () => {
    const project = await createProjectFromSource({
      actorId,
      workspaceId,
      name: 'Platform',
      slug: 'platform',
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      integrations: integrations as IntegrationsModuleClient,
    });

    const events = await db()
      .select()
      .from(projectsOutbox)
      .where(sql`${projectsOutbox.payload}->>'projectId' = ${project.id}`);

    expect(events.map((event) => event.eventType).sort()).toEqual([
      'projects.project.created',
      'projects.project.source_bound',
    ]);
    expect(events.map((event) => event.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'platform',
          sourceConnectionId,
          sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        }),
        expect.objectContaining({
          sourceConnectionId,
          externalRepositoryId: 'gitea:gitea-owner/platform',
          provider: 'gitea',
        }),
      ]),
    );
  });

  test('rejects a second project for the same source repository', async () => {
    await createProjectFromSource({
      actorId,
      workspaceId,
      name: 'Platform',
      slug: 'platform',
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      integrations: integrations as IntegrationsModuleClient,
    });

    const result = createProjectFromSource({
      actorId,
      workspaceId,
      name: 'Platform Again',
      slug: 'platform-again',
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      integrations: integrations as IntegrationsModuleClient,
    });

    await expect(result).rejects.toThrow('Project already exists');
  });

  test('surfaces provider repository access failures', async () => {
    vi.mocked(integrations.resolveSourceRepository).mockRejectedValueOnce(
      createInterModuleKnownError(
        integrationsInterModuleContract.methods.resolveSourceRepository,
        'provider-failure',
        {reason: 'repository-not-found'},
      ),
    );

    const result = createProjectFromSource({
      actorId,
      workspaceId,
      name: 'Missing',
      slug: 'missing',
      sourceConnectionId,
      sourceExternalRepositoryId: 'not-found',
      integrations: integrations as IntegrationsModuleClient,
    });

    await expect(result).rejects.toMatchObject({
      code: 'provider-failure',
      details: {reason: 'repository-not-found'},
    });
  });
});
