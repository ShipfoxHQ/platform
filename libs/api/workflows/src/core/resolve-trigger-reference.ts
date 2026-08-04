import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {TriggerPayload, WorkflowRunTriggerReference} from './entities/workflow-run.js';

export async function resolveWorkflowRunTriggerReference(params: {
  workspaceId: string;
  triggerConnectionId?: string | undefined;
  triggerPayload: TriggerPayload;
  integrations?: IntegrationsModuleClient | undefined;
  projects?: ProjectsModuleClient | undefined;
}): Promise<WorkflowRunTriggerReference | null> {
  if (
    params.triggerConnectionId === undefined ||
    !('data' in params.triggerPayload) ||
    params.integrations === undefined ||
    params.projects === undefined
  ) {
    return null;
  }

  try {
    const reference = await params.integrations.resolveTriggerReference({
      workspaceId: params.workspaceId,
      connectionId: params.triggerConnectionId,
      payload: params.triggerPayload.data,
    });
    if (reference === null) return null;

    const [projectResult, sourceResult] = await Promise.all([
      params.projects.getProjectBySource({
        workspaceId: params.workspaceId,
        sourceConnectionId: params.triggerConnectionId,
        sourceExternalRepositoryId: reference.externalRepositoryId,
      }),
      params.integrations.resolveSourceRepository({
        workspaceId: params.workspaceId,
        connectionId: params.triggerConnectionId,
        externalRepositoryId: reference.externalRepositoryId,
      }),
    ]);

    return {
      project: projectResult.project === null ? null : {id: projectResult.project.id},
      repository: `${sourceResult.repository.owner}/${sourceResult.repository.name}`,
      ref: reference.ref,
      commit: reference.commit,
      actor: reference.actor,
    };
  } catch {
    // Trigger metadata is best-effort and must not block run creation.
    return null;
  }
}
