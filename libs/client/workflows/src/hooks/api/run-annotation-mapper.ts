import type {AnnotationDto} from '@shipfox/annotations-dto';
import type {
  WorkflowRunAnnotationItemDto,
  WorkflowRunAnnotationsResponseDto,
  WorkflowRunJobExplanationDto,
  WorkflowRunJobExplanationsResponseDto,
} from '@shipfox/api-workflows-dto';
import type {
  RunAnnotationEntry,
  RunAnnotationRecord,
  RunJobExplanation,
} from '#core/run-annotation.js';
import {toEvaluationTrace} from './workflow-run-mapper.js';

export interface RunAnnotationPage {
  entries: RunAnnotationEntry[];
  nextCursor: string | null;
}

export interface RunJobExplanationPage {
  explanations: RunJobExplanation[];
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

export function toRunAnnotationEntry(item: WorkflowRunAnnotationItemDto): RunAnnotationEntry {
  const {annotation, origin} = item;
  return {
    annotation: toRunAnnotation(annotation),
    jobName: origin.job_label,
    jobPosition: origin.job_position,
    executionSequence: origin.execution_sequence,
    executionLabel: origin.execution_label,
    stepLabel: origin.step_label,
    attemptLabel: `attempt ${origin.step_attempt}`,
    origin: origin.step_attempt_id
      ? {
          jobId: origin.job_id,
          jobExecutionId: origin.job_execution_id,
          stepId: origin.step_id,
          stepAttemptId: origin.step_attempt_id,
        }
      : null,
  };
}

export function toRunAnnotationPage(
  response: Pick<WorkflowRunAnnotationsResponseDto, 'items' | 'next_cursor'>,
): RunAnnotationPage {
  return {
    entries: response.items.map(toRunAnnotationEntry),
    nextCursor: response.next_cursor,
  };
}

export function toRunJobExplanation(dto: WorkflowRunJobExplanationDto): RunJobExplanation {
  return {
    jobId: dto.job_id,
    jobName: dto.job_label,
    jobPosition: dto.job_position,
    status: dto.status,
    statusReason: dto.status_reason,
    evaluationTrace: toEvaluationTrace(dto.evaluation_trace),
  };
}

export function toRunJobExplanationPage(
  response: Pick<WorkflowRunJobExplanationsResponseDto, 'items' | 'next_cursor'>,
): RunJobExplanationPage {
  return {
    explanations: response.items.map(toRunJobExplanation),
    nextCursor: response.next_cursor,
  };
}
