import type {IntegrationConnectionAvailableEvent} from '@shipfox/api-integration-core-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {boundedMap} from '@shipfox/node-module';
import type {DomainEvent} from '@shipfox/node-outbox';
import {startDefinitionSync} from './start-definition-sync.js';

const PROJECT_PAGE_SIZE = 100;
const SYNC_START_CONCURRENCY = 10;

export function createOnIntegrationConnectionAvailable(
  projects: Pick<ProjectsModuleClient, 'listProjectsByWorkspace'>,
) {
  return async function onIntegrationConnectionAvailable(
    payload: IntegrationConnectionAvailableEvent,
    event: DomainEvent<IntegrationConnectionAvailableEvent>,
  ): Promise<void> {
    let cursor: {createdAt: string; id: string} | undefined;

    do {
      const page = await projects.listProjectsByWorkspace({
        workspaceId: payload.workspaceId,
        limit: PROJECT_PAGE_SIZE,
        ...(cursor ? {cursor} : {}),
      });

      await boundedMap(
        page.projects,
        SYNC_START_CONCURRENCY,
        async (project) => {
          await startDefinitionSync({
            projectId: project.id,
            workspaceId: project.workspaceId,
            sourceConnectionId: project.sourceConnectionId,
            externalRepositoryId: project.sourceExternalRepositoryId,
            requestId: `integration:${event.id}`,
          });
        },
        {stopOnError: true},
      );

      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  };
}
