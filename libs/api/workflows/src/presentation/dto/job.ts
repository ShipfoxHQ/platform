import type {JobDto} from '@shipfox/api-workflows-dto';
import type {Job} from '#core/entities/job.js';

export function toJobDto(job: Job): JobDto {
  return {
    id: job.id,
    run_id: job.runId,
    name: job.name,
    status: job.status,
    dependencies: job.dependencies,
    position: job.position,
    created_at: job.createdAt.toISOString(),
    updated_at: job.updatedAt.toISOString(),
  };
}
