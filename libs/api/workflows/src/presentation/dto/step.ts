import type {StepDto} from '@shipfox/api-workflows-dto';
import type {Step} from '#core/entities/step.js';

export function toStepDto(step: Step): StepDto {
  return {
    id: step.id,
    job_id: step.jobId,
    name: step.name,
    status: step.status,
    type: step.type,
    config: step.config,
    position: step.position,
    created_at: step.createdAt.toISOString(),
    updated_at: step.updatedAt.toISOString(),
  };
}
