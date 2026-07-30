import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import {Factory} from 'fishery';
import type {WorkflowRun} from '#core/entities/workflow-run.js';
import {createWorkflowRun} from '#db/workflow-runs.js';
import {workflowModel} from './workflow-model.js';

interface WorkflowRunTransientParams {
  model?: WorkflowModel | undefined;
}

export const workflowRunFactory = Factory.define<WorkflowRun, WorkflowRunTransientParams>(
  ({transientParams, onCreate}) => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();

    onCreate((run) => {
      return createWorkflowRun({
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        definitionId: run.definitionId,
        name: run.workflowName,
        model: transientParams.model ?? workflowModel({name: run.name}),
        triggerPayload: run.triggerPayload,
        inputs: run.inputs ?? undefined,
        sourceSnapshot: run.sourceSnapshot,
      });
    });

    return {
      id: crypto.randomUUID(),
      workspaceId,
      projectId,
      definitionId,
      name: 'Test Workflow',
      workflowName: 'Test Workflow',
      nameOverride: null,
      status: 'pending',
      currentAttempt: 1,
      triggerProvider: null,
      triggerSource: 'manual',
      triggerEvent: 'fire',
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
      inputs: null,
      sourceSnapshot: null,
      triggerIdempotencyKey: null,
      timeoutMs: 30 * 24 * 60 * 60 * 1000,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: null,
      finishedAt: null,
    };
  },
);
