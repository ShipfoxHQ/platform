import type {Job, JobExecution, WorkflowRunStatus} from './workflow-run.js';
import {isWorkflowRunTerminal} from './workflow-run.js';

export type RunAnnotationStyle = 'default' | 'info' | 'success' | 'warning' | 'error';

export interface RunAnnotation {
  id: string;
  jobId: string;
  jobExecutionId: string;
  originStepId: string;
  originStepAttempt: number;
  context: string;
  style: RunAnnotationStyle;
  sequence: number;
  body: string;
}

export type RunAnnotationExecutionGroup =
  | {
      kind: 'matched';
      job: Job;
      jobExecution: JobExecution;
      annotations: RunAnnotation[];
    }
  | {
      kind: 'unmatched';
      jobExecutionId: string;
      annotations: RunAnnotation[];
    };

export const RUN_ANNOTATIONS_POLL_MS = 4_000;
export const RUN_ANNOTATIONS_TERMINAL_GRACE_POLLS = 3;

export function selectStepAnnotations(
  annotations: readonly RunAnnotation[],
  {
    stepId,
    attempt,
  }: {
    stepId: string | undefined;
    attempt: number | undefined;
  },
): RunAnnotation[] {
  if (!stepId || !attempt) return [];

  return sortAnnotations(
    annotations.filter(
      (annotation) =>
        annotation.originStepId === stepId && annotation.originStepAttempt === attempt,
    ),
  );
}

export function selectJobExecutionAnnotations(
  annotations: readonly RunAnnotation[],
  {jobExecutionId}: {jobExecutionId: string | undefined},
): RunAnnotation[] {
  if (!jobExecutionId) return [];

  return sortAnnotations(
    annotations.filter((annotation) => annotation.jobExecutionId === jobExecutionId),
  );
}

export function groupRunAnnotationsByExecution(
  annotations: readonly RunAnnotation[],
  jobs: readonly Job[],
): RunAnnotationExecutionGroup[] {
  if (annotations.length === 0) return [];

  const annotationsByExecutionId = new Map<string, RunAnnotation[]>();
  for (const annotation of annotations) {
    const group = annotationsByExecutionId.get(annotation.jobExecutionId) ?? [];
    group.push(annotation);
    annotationsByExecutionId.set(annotation.jobExecutionId, group);
  }

  const groups: RunAnnotationExecutionGroup[] = [];
  for (const job of jobs) {
    for (const jobExecution of job.jobExecutions) {
      const executionAnnotations = annotationsByExecutionId.get(jobExecution.id);
      if (!executionAnnotations || executionAnnotations.length === 0) continue;

      groups.push({
        kind: 'matched',
        job,
        jobExecution,
        annotations: sortAnnotations(executionAnnotations),
      });
      annotationsByExecutionId.delete(jobExecution.id);
    }
  }

  for (const [jobExecutionId, unmatchedAnnotations] of annotationsByExecutionId) {
    groups.push({
      kind: 'unmatched',
      jobExecutionId,
      annotations: sortAnnotations(unmatchedAnnotations),
    });
  }

  return groups;
}

export function runAnnotationsRefetchInterval({
  runStatus,
  graceLeft,
}: {
  runStatus: WorkflowRunStatus | undefined;
  graceLeft: number;
}): typeof RUN_ANNOTATIONS_POLL_MS | false {
  if (!runStatus) return RUN_ANNOTATIONS_POLL_MS;
  if (!isWorkflowRunTerminal(runStatus)) return RUN_ANNOTATIONS_POLL_MS;
  return graceLeft > 0 ? RUN_ANNOTATIONS_POLL_MS : false;
}

function sortAnnotations(annotations: readonly RunAnnotation[]): RunAnnotation[] {
  return [...annotations].sort((left, right) => {
    const sequenceDelta = left.sequence - right.sequence;
    if (sequenceDelta !== 0) return sequenceDelta;
    return left.id.localeCompare(right.id);
  });
}
