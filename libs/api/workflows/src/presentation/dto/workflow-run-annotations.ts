import type {AnnotationDto} from '@shipfox/annotations-dto';
import type {
  WorkflowRunAnnotationItemDto,
  WorkflowRunJobExplanationDto,
} from '@shipfox/api-workflows-dto';
import type {WorkflowRunAnnotationOriginRead, WorkflowRunJobExplanationRead} from '#db/index.js';
import {toEvaluationTraceDto} from './evaluation-trace.js';

export function toWorkflowRunAnnotationItemDto(
  annotation: AnnotationDto,
  origin: WorkflowRunAnnotationOriginRead,
): WorkflowRunAnnotationItemDto {
  return {
    annotation,
    origin: {
      job_id: origin.jobId,
      job_label: origin.jobLabel,
      job_position: origin.jobPosition,
      job_execution_id: origin.jobExecutionId,
      execution_sequence: origin.executionSequence,
      execution_label: origin.executionLabel,
      step_id: origin.stepId,
      step_label: origin.stepLabel,
      step_attempt_id: origin.stepAttemptId,
      step_attempt: origin.stepAttempt,
    },
  };
}

export function toWorkflowRunJobExplanationDto(
  explanation: WorkflowRunJobExplanationRead,
): WorkflowRunJobExplanationDto {
  return {
    job_id: explanation.jobId,
    job_label: explanation.jobLabel,
    job_position: explanation.jobPosition,
    status: explanation.status,
    status_reason: explanation.statusReason,
    evaluation_trace: toEvaluationTraceDto(explanation.evaluationTrace),
  };
}
