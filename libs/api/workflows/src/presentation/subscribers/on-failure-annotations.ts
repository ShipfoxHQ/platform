import {
  type AnnotationsInterModuleClient,
  annotationsInterModuleContract,
} from '@shipfox/annotations-dto/inter-module';
import type {
  WorkflowsJobTerminatedEventDto,
  WorkflowsStepAttemptTerminatedEventDto,
} from '@shipfox/api-workflows-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {
  getJobExecutionFailureOrigin,
  getJobScope,
  getStepAttemptDetail,
  getWorkflowRunAttemptById,
} from '#db/index.js';
import {recordWorkflowFailureAnnotationFailed} from '#metrics/instance.js';

const JOB_FAILURE_ANNOTATION_REASONS = new Set([
  'timed_out',
  'runner_lost',
  'condition_errored',
  'output_too_large',
]);

export function onStepAttemptTerminatedFailureAnnotation(
  annotations: AnnotationsInterModuleClient,
) {
  return async (payload: WorkflowsStepAttemptTerminatedEventDto): Promise<void> => {
    // A first successful/cancelled attempt cannot have a stale failure annotation.
    // Keep later terminal attempts on the lookup path so recovery removes the
    // annotation created by an earlier failed attempt.
    if (payload.status !== undefined && payload.status !== 'failed' && payload.attempt === 1) {
      return;
    }

    try {
      const initialDetail = await getStepAttemptDetail({
        stepId: payload.stepId,
        attempt: payload.attempt,
      });
      if (!initialDetail) return;

      // The detail query joins the requested attempt to the step's current projection. A
      // delayed event can therefore return an old attempt alongside a newer step status. Read
      // the canonical current attempt before deciding whether to replace or remove the card.
      const detail =
        initialDetail.attempt.attempt === initialDetail.step.currentAttempt
          ? initialDetail
          : await getStepAttemptDetail({
              stepId: initialDetail.step.id,
              attempt: initialDetail.step.currentAttempt,
            });
      if (!detail || detail.attempt.attempt !== detail.step.currentAttempt) return;

      const runAttempt = await getWorkflowRunAttemptById(payload.workflowRunAttemptId);
      if (!runAttempt) return;

      await writeFailureAnnotation({
        annotations,
        target: {
          workspaceId: payload.workspaceId,
          projectId: payload.projectId,
          workflowRunId: payload.workflowRunId,
          workflowRunAttempt: runAttempt.attempt,
          workflowRunAttemptId: payload.workflowRunAttemptId,
          jobId: payload.jobId,
          jobExecutionId: detail.step.jobExecutionId,
          originStepId: detail.step.id,
          originStepAttempt: detail.attempt.attempt,
        },
        context: failureContext('step', detail.step.id),
        failed:
          detail.step.status === 'failed' ||
          (detail.attempt.status === 'failed' &&
            detail.step.status !== 'succeeded' &&
            detail.step.status !== 'cancelled'),
        body: stepFailureBody(
          detail.step.name,
          detail.attempt.error ?? detail.step.error,
          detail.attempt.exitCode,
        ),
      });
    } catch (error) {
      recordFailureAnnotationFailure(error, 'lookup', {
        stepId: payload.stepId,
        jobId: payload.jobId,
      });
    }
  };
}

export function onJobTerminatedFailureAnnotation(annotations: AnnotationsInterModuleClient) {
  return async (payload: WorkflowsJobTerminatedEventDto): Promise<void> => {
    // Step failures already have a step-scoped annotation. Job-scoped annotations
    // are reserved for terminal causes where no step-level failure card exists.
    const isConditionEvaluationFailure =
      payload.status === 'skipped' && payload.statusReason === 'condition_errored';
    if (
      (payload.status !== 'failed' && !isConditionEvaluationFailure) ||
      !JOB_FAILURE_ANNOTATION_REASONS.has(payload.statusReason ?? '')
    ) {
      return;
    }

    try {
      const [scope, runAttempt] = await Promise.all([
        getJobScope(payload.jobId),
        getWorkflowRunAttemptById(payload.workflowRunAttemptId),
      ]);
      if (!scope || !runAttempt || !payload.jobExecutionId) return;

      const origin = await getJobExecutionFailureOrigin(payload.jobExecutionId);
      if (!origin) return;

      await writeFailureAnnotation({
        annotations,
        target: {
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          workflowRunId: payload.workflowRunId,
          workflowRunAttempt: runAttempt.attempt,
          workflowRunAttemptId: payload.workflowRunAttemptId,
          jobId: payload.jobId,
          jobExecutionId: origin.jobExecutionId,
          originStepId: origin.stepId,
          originStepAttempt: origin.stepAttempt,
        },
        context: failureContext('job', payload.jobId),
        failed: true,
        body: jobFailureBody(payload.statusReason, payload.statusReasonMessage, origin),
      });
    } catch (error) {
      recordFailureAnnotationFailure(error, 'lookup', {jobId: payload.jobId});
    }
  };
}

type FailureAnnotationTarget = {
  workspaceId: string;
  projectId: string;
  workflowRunId: string;
  workflowRunAttempt: number;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  originStepId: string;
  originStepAttempt: number;
};

/**
 * Failure annotations are a best-effort projection. The workflow terminal fact is authoritative;
 * projection lookup and writes are swallowed so they cannot change the workflow outcome. Every
 * swallowed error emits a reason-labelled metric and a structured warning for operations.
 */
async function writeFailureAnnotation(params: {
  annotations: AnnotationsInterModuleClient;
  target: FailureAnnotationTarget;
  context: string;
  failed: boolean;
  body: string;
}): Promise<void> {
  try {
    await params.annotations.replaceOrRemoveAnnotation({
      ...params.target,
      context: params.context,
      annotation: params.failed
        ? {op: 'replace', style: 'error', body: params.body}
        : {op: 'remove'},
    });
  } catch (error) {
    const reason = isInterModuleKnownError(
      annotationsInterModuleContract.methods.replaceOrRemoveAnnotation,
      error,
    )
      ? 'budget'
      : 'write';
    recordFailureAnnotationFailure(error, reason, params.target);
  }
}

function failureContext(kind: 'job' | 'step', id: string): string {
  return `failure:${kind}:${id}`;
}

function stepFailureBody(
  name: string,
  error: Record<string, unknown> | null,
  exitCode: number | null,
): string {
  const reason = typeof error?.reason === 'string' ? error.reason : 'unknown';
  const message =
    typeof error?.message === 'string' && error.message.trim()
      ? error.message
      : 'No failure message was recorded.';
  return [
    `**${name} failed**`,
    '',
    `Reason: \`${reason}\``,
    `Exit code: \`${exitCode ?? 'none'}\``,
    '',
    message,
  ].join('\n');
}

function jobFailureBody(
  reason: string | null,
  statusReasonMessage: string | null | undefined,
  origin: {
    stepName: string;
    attemptStatus: string | null;
    stepError: Record<string, unknown> | null;
    attemptError: Record<string, unknown> | null;
    attemptExitCode: number | null;
  },
): string {
  const progress = origin.attemptStatus
    ? `The job stopped while processing **${origin.stepName}**.`
    : `The job stopped before **${origin.stepName}** started.`;
  const error = origin.attemptError ?? origin.stepError;
  const message = typeof error?.message === 'string' && error.message.trim() ? error.message : null;
  const exitCode =
    origin.attemptExitCode === null ? null : `Exit code: \`${origin.attemptExitCode}\``;
  return [
    `**Job failed before completion**`,
    '',
    progress,
    `Reason: \`${reason ?? 'unknown'}\``,
    statusReasonMessage ? `Failure: ${statusReasonMessage}` : null,
    message ? `Failure: ${message}` : null,
    exitCode,
  ]
    .filter(Boolean)
    .join('\n');
}

function recordFailureAnnotationFailure(
  error: unknown,
  reason: 'lookup' | 'budget' | 'write',
  context: Record<string, string | number>,
): void {
  recordWorkflowFailureAnnotationFailed(reason);
  logger().warn({error, reason, ...context}, 'Failed to project workflow failure annotation');
}
