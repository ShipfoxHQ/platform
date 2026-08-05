import {temporalClient} from '@shipfox/node-temporal';
import {DEFINITION_SYNC_WORKFLOW, DEFINITIONS_TASK_QUEUE} from '#temporal/index.js';

export interface StartDefinitionSyncParams {
  projectId: string;
  workspaceId: string;
  sourceConnectionId: string;
  externalRepositoryId: string;
  sourceRef?: string | undefined;
  sourceCommitSha?: string | undefined;
  requestId?: string | undefined;
}

export async function startDefinitionSync(params: StartDefinitionSyncParams): Promise<void> {
  const workflowId = buildWorkflowId(params);

  try {
    await temporalClient().workflow.start(DEFINITION_SYNC_WORKFLOW, {
      taskQueue: DEFINITIONS_TASK_QUEUE,
      workflowId,
      workflowIdConflictPolicy: 'USE_EXISTING',
      workflowIdReusePolicy: params.requestId ? 'REJECT_DUPLICATE' : 'ALLOW_DUPLICATE',
      args: [
        {
          projectId: params.projectId,
          workspaceId: params.workspaceId,
          sourceConnectionId: params.sourceConnectionId,
          sourceExternalRepositoryId: params.externalRepositoryId,
          sourceRef: params.sourceRef,
          sourceCommitSha: params.sourceCommitSha,
        },
      ],
    });
  } catch (error) {
    if (
      params.requestId &&
      error instanceof Error &&
      error.name === 'WorkflowExecutionAlreadyStartedError'
    ) {
      return;
    }
    throw error;
  }
}

function buildWorkflowId(params: StartDefinitionSyncParams): string {
  if (params.sourceCommitSha) {
    return `definition-sync:${params.projectId}:${params.sourceCommitSha}`;
  }
  if (params.requestId) {
    return `definition-sync:${params.projectId}:${params.requestId}`;
  }
  return `definition-sync:${params.projectId}:bind`;
}
