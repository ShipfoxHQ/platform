import type {AnnotationDto} from '@shipfox/annotations-dto';
import type {AnnotationReadDto} from '@shipfox/annotations-dto/inter-module';
import type {Annotation} from '#core/entities/annotation.js';

export function toAnnotationDto(annotation: Annotation): AnnotationDto {
  return {
    id: annotation.id,
    job_id: annotation.jobId,
    job_execution_id: annotation.jobExecutionId,
    origin_step_id: annotation.originStepId,
    origin_step_attempt: annotation.originStepAttempt,
    context: annotation.context,
    style: annotation.style,
    sequence: annotation.sequence,
    body: annotation.body,
  };
}

export function toAnnotationReadDto(annotation: Annotation): AnnotationReadDto {
  return {
    ...toAnnotationDto(annotation),
    createdAt: annotation.createdAt.toISOString(),
  };
}
