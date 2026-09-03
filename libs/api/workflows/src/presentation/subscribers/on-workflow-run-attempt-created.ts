import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {WorkflowsWorkflowRunAttemptCreatedEventDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {WORKFLOWS_TASK_QUEUE} from '#temporal/constants.js';

export function createOnWorkflowRunAttemptCreated(
  agent: Pick<AgentInterModuleClient, 'carryOverSessions'>,
) {
  return async (payload: WorkflowsWorkflowRunAttemptCreatedEventDto): Promise<void> => {
    if (payload.carryOverFromWorkflowRunAttemptId === undefined) {
      return onWorkflowRunAttemptCreated(payload);
    }

    logger().info(
      {
        workflowRunId: payload.workflowRunId,
        workflowRunAttemptId: payload.workflowRunAttemptId,
        sourceWorkflowRunAttemptId: payload.carryOverFromWorkflowRunAttemptId,
      },
      'Carrying agent sessions before starting workflow run orchestration',
    );
    await agent.carryOverSessions({
      fromWorkflowRunAttemptId: payload.carryOverFromWorkflowRunAttemptId,
      toWorkflowRunAttemptId: payload.workflowRunAttemptId,
    });
    await onWorkflowRunAttemptCreated(payload);
  };
}

export async function onWorkflowRunAttemptCreated(
  payload: WorkflowsWorkflowRunAttemptCreatedEventDto,
): Promise<void> {
  logger().info(
    {workflowRunId: payload.workflowRunId, workflowRunAttemptId: payload.workflowRunAttemptId},
    'Starting workflow run attempt orchestration',
  );
  try {
    await temporalClient().workflow.start('runOrchestration', {
      taskQueue: WORKFLOWS_TASK_QUEUE,
      workflowId: `workflow-run-attempt:${payload.workflowRunAttemptId}`,
      workflowIdConflictPolicy: 'USE_EXISTING',
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
      args: [
        {
          workflowRunId: payload.workflowRunId,
          runAttemptId: payload.workflowRunAttemptId,
          workspaceId: payload.workspaceId,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError') {
      logger().info(
        {
          workflowRunId: payload.workflowRunId,
          workflowRunAttemptId: payload.workflowRunAttemptId,
        },
        'Orchestration already started, skipping',
      );
      return;
    }
    throw error;
  }
}
