import {getDefinitionById} from '@shipfox/api-definitions';
import {createWorkflowRun} from '#db/workflow-runs.js';
import type {WorkflowRun} from './entities/workflow-run.js';
import {DefinitionNotFoundError, ProjectMismatchError} from './errors.js';

export interface RunWorkflowParams {
  workspaceId: string;
  projectId: string;
  definitionId: string;
  inputs?: Record<string, unknown> | undefined;
}

export async function runWorkflow(params: RunWorkflowParams): Promise<WorkflowRun> {
  const definition = await getDefinitionById(params.definitionId);
  if (!definition) throw new DefinitionNotFoundError(params.definitionId);

  if (definition.projectId !== params.projectId) {
    throw new ProjectMismatchError(definition.projectId, params.projectId);
  }

  return createWorkflowRun({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    definitionId: definition.id,
    definition: definition.definition,
    triggerContext: {type: 'manual'},
    inputs: params.inputs,
  });
}
