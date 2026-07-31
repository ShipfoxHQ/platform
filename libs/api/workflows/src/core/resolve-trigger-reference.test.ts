import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {TriggerPayload} from './entities/workflow-run.js';
import {resolveWorkflowRunTriggerReference} from './resolve-trigger-reference.js';

describe('resolveWorkflowRunTriggerReference', () => {
  const workspaceId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();

  it.each([
    {
      event: 'push',
      externalRepositoryId: 'github:42',
      ref: 'refs/heads/main',
    },
    {
      event: 'pull_request',
      externalRepositoryId: 'github:43',
      ref: 'refs/pull/12/head',
    },
  ])('resolves the normalized %s trigger facts with its project', async (reference) => {
    const integrations = {
      resolveTriggerReference: vi.fn().mockResolvedValue({
        externalRepositoryId: reference.externalRepositoryId,
        ref: reference.ref,
        commit: 'a'.repeat(40),
      }),
      resolveSourceRepository: vi.fn().mockResolvedValue({
        connection: {id: connectionId, provider: 'github', slug: 'github-main'},
        repository: {
          externalRepositoryId: reference.externalRepositoryId,
          owner: 'acme',
          name: 'api',
          fullName: 'acme/api',
          defaultBranch: 'main',
          visibility: 'private' as const,
          cloneUrl: 'https://github.com/acme/api.git',
          htmlUrl: 'https://github.com/acme/api',
        },
      }),
    } as unknown as IntegrationsModuleClient;
    const projects = {
      getProjectBySource: vi.fn().mockResolvedValue({project: {id: 'project-1'}}),
    } as unknown as ProjectsModuleClient;
    const triggerPayload: TriggerPayload = {
      provider: 'github',
      source: 'github-main',
      event: reference.event,
      deliveryId: 'delivery-1',
      data: {event: reference.event},
    };

    await expect(
      resolveWorkflowRunTriggerReference({
        workspaceId,
        triggerConnectionId: connectionId,
        triggerPayload,
        integrations,
        projects,
      }),
    ).resolves.toEqual({
      project: {id: 'project-1'},
      repository: 'acme/api',
      ref: reference.ref,
      commit: 'a'.repeat(40),
    });
    expect(projects.getProjectBySource).toHaveBeenCalledWith({
      workspaceId,
      sourceConnectionId: connectionId,
      sourceExternalRepositoryId: reference.externalRepositoryId,
    });
  });

  it('returns null for a provider event without a source-control reference', async () => {
    const resolveTriggerReference = vi.fn().mockResolvedValue(null);
    const resolveSourceRepository = vi.fn();
    const integrations = {
      resolveTriggerReference,
      resolveSourceRepository,
    } as unknown as IntegrationsModuleClient;
    const projects = {
      getProjectBySource: vi.fn(),
    } as unknown as ProjectsModuleClient;

    await expect(
      resolveWorkflowRunTriggerReference({
        workspaceId,
        triggerConnectionId: connectionId,
        triggerPayload: {
          provider: 'linear',
          source: 'linear-main',
          event: 'Issue.create',
          deliveryId: 'delivery-1',
          data: {type: 'Issue'},
        },
        integrations,
        projects,
      }),
    ).resolves.toBeNull();
    expect(resolveSourceRepository).not.toHaveBeenCalled();
    expect(projects.getProjectBySource).not.toHaveBeenCalled();
  });

  it.each([
    'trigger reference',
    'project lookup',
    'source repository lookup',
  ] as const)('returns null when %s fails during enrichment', async (failure) => {
    const integrations = {
      resolveTriggerReference:
        failure === 'trigger reference'
          ? vi.fn().mockRejectedValue(new Error('trigger reference unavailable'))
          : vi.fn().mockResolvedValue({
              externalRepositoryId: 'github:42',
              ref: 'refs/heads/main',
              commit: 'a'.repeat(40),
            }),
      resolveSourceRepository:
        failure === 'source repository lookup'
          ? vi.fn().mockRejectedValue(new Error('source repository unavailable'))
          : vi.fn().mockResolvedValue({
              connection: {id: connectionId, provider: 'github', slug: 'github-main'},
              repository: {
                externalRepositoryId: 'github:42',
                owner: 'acme',
                name: 'api',
                fullName: 'acme/api',
                defaultBranch: 'main',
                visibility: 'private' as const,
                cloneUrl: 'https://github.com/acme/api.git',
                htmlUrl: 'https://github.com/acme/api',
              },
            }),
    } as unknown as IntegrationsModuleClient;
    const projects = {
      getProjectBySource:
        failure === 'project lookup'
          ? vi.fn().mockRejectedValue(new Error('project lookup unavailable'))
          : vi.fn().mockResolvedValue({project: {id: 'project-1'}}),
    } as unknown as ProjectsModuleClient;

    await expect(
      resolveWorkflowRunTriggerReference({
        workspaceId,
        triggerConnectionId: connectionId,
        triggerPayload: {
          provider: 'github',
          source: 'github-main',
          event: 'push',
          deliveryId: 'delivery-1',
          data: {event: 'push'},
        },
        integrations,
        projects,
      }),
    ).resolves.toBeNull();
  });
});
