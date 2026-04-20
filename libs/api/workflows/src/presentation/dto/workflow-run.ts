import type {RunDto} from '@shipfox/api-workflows-dto';
import type {WorkflowRun} from '#core/entities/workflow-run.js';

export function toRunDto(run: WorkflowRun): RunDto {
  return {
    id: run.id,
    project_id: run.projectId,
    definition_id: run.definitionId,
    status: run.status,
    trigger_context: run.triggerContext,
    inputs: run.inputs,
    created_at: run.createdAt.toISOString(),
    updated_at: run.updatedAt.toISOString(),
  };
}
