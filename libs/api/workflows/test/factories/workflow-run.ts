import {Factory} from 'fishery';
import type {WorkflowRun} from '#core/entities/workflow-run.js';
import {createWorkflowRun} from '#db/workflow-runs.js';

export const workflowRunFactory = Factory.define<WorkflowRun>(({onCreate}) => {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const definitionId = crypto.randomUUID();

  onCreate((run) => {
    return createWorkflowRun({
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      definitionId: run.definitionId,
      definition: {
        name: 'Test Workflow',
        jobs: {
          build: {
            steps: [{run: 'echo hello'}],
          },
        },
      },
      triggerContext: {type: 'manual'},
      inputs: run.inputs ?? undefined,
    });
  });

  return {
    id: crypto.randomUUID(),
    workspaceId,
    projectId,
    definitionId,
    status: 'pending',
    triggerContext: {type: 'manual'},
    inputs: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
