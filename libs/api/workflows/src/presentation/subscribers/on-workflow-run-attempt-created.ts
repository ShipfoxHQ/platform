import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {WorkflowsWorkflowRunAttemptCreatedEventDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {listRunAttempts} from '#db/index.js';
import {WORKFLOWS_TASK_QUEUE} from '#temporal/constants.js';

export async function onWorkflowRunAttemptCreated(
  payload: WorkflowsWorkflowRunAttemptCreatedEventDto,
  agent?: AgentInterModuleClient,
): Promise<void> {
  if (agent) {
    const attempts = await listRunAttempts({
      workflowRunId: payload.workflowRunId,
      projectId: payload.projectId,
    });
    const targetAttempt = attempts.find((attempt) => attempt.id === payload.workflowRunAttemptId);
    if (targetAttempt?.rerunMode === 'failed') {
      const sourceAttempt = attempts.find(
        (attempt) => attempt.attempt === targetAttempt.attempt - 1,
      );
      if (!sourceAttempt) throw new Error('Failed rerun source attempt not found');
      await agent.carryOverSessions({
        fromWorkflowRunAttemptId: sourceAttempt.id,
        toWorkflowRunAttemptId: targetAttempt.id,
      });
    }
  }

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
