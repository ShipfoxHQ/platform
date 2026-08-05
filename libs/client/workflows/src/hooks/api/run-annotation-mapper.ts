import type {AnnotationDto, ReadAnnotationsResponseDto} from '@shipfox/annotations-dto';
import type {RunAnnotationRecord} from '#core/run-annotation.js';

export interface RunAnnotationPage {
  annotations: RunAnnotationRecord[];
  hasMore: boolean;
  nextCursor: string | null;
}

export function toRunAnnotation(dto: AnnotationDto): RunAnnotationRecord {
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

export function toRunAnnotationPage(response: ReadAnnotationsResponseDto): RunAnnotationPage {
  return {
    annotations: response.annotations.map(toRunAnnotation),
    hasMore: response.has_more,
    nextCursor: response.next_cursor,
  };
}
