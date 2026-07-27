import type {AnnotationDto} from '@shipfox/annotations-dto';
import type {RunAnnotation} from '#core/run-annotation.js';

export function toRunAnnotation(dto: AnnotationDto): RunAnnotation {
  return {
    id: dto.id,
    jobId: dto.job_id,
    jobExecutionId: dto.job_execution_id,
    originStepId: dto.origin_step_id,
    originStepAttempt: dto.origin_step_attempt,
    context: dto.context,
    style: dto.style,
    sequence: dto.sequence,
    body: dto.body,
  };
}
