import type {WorkflowRunCreatedEvent} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {DomainEvent} from '@shipfox/node-outbox';
import {temporalClient} from '@shipfox/node-temporal';
import {WORKFLOWS_TASK_QUEUE} from '#temporal/constants.js';

export async function onWorkflowRunCreated(event: DomainEvent): Promise<void> {
  const payload = event.payload as WorkflowRunCreatedEvent;
  logger().info({runId: payload.runId}, 'Starting workflow run orchestration');
  try {
    await temporalClient().workflow.start('runOrchestration', {
      taskQueue: WORKFLOWS_TASK_QUEUE,
      workflowId: `run:${payload.runId}`,
      args: [{runId: payload.runId, workspaceId: payload.workspaceId}],
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError') {
      logger().info({runId: payload.runId}, 'Orchestration already started, skipping');
      return;
    }
    throw error;
  }
}
