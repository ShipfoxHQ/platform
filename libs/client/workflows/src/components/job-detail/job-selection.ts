import {
  compareStepAttempts,
  type Job,
  type JobExecution,
  resolveJobExecution,
  resolveStepAttempt,
  type Step,
  type StepAttempt,
} from '#core/workflow-run.js';
import type {WorkflowJobSearch} from '#routes/inputs.js';

export interface ResolvedWorkflowJobSelection {
  jobExecution: JobExecution | undefined;
  step: Step | undefined;
  attempt: StepAttempt | undefined;
  selectedAttemptId: string | null;
}

export interface WorkflowJobLandingSelection {
  stepId: string;
  attemptId: string;
}

/**
 * Resolves job-scoped URL state. A valid step is authoritative over an execution id because a
 * step carries its owning execution. A step from another job is ignored and falls back to the
 * job's default execution rather than following a mangled URL into a different job.
 */
export function resolveWorkflowJobSelection({
  job,
  selection,
}: {
  job: Job;
  selection: WorkflowJobSearch;
}): ResolvedWorkflowJobSelection {
  const step = selection.stepId ? findStep(job, selection.stepId) : undefined;
  if (step) {
    const attempt = resolveStepAttempt(step, selection.stepAttemptId);
    const jobExecution = job.jobExecutions.find(
      (candidate) => candidate.id === step.jobExecutionId,
    );
    return {
      jobExecution: jobExecution ?? resolveJobExecution(job, undefined),
      step,
      attempt,
      selectedAttemptId: attempt?.id ?? null,
    };
  }

  return {
    jobExecution: selection.stepId
      ? resolveJobExecution(job, undefined)
      : resolveJobExecution(job, selection.jobExecutionId),
    step: undefined,
    attempt: undefined,
    selectedAttemptId: null,
  };
}

/** Picks the running step, then the first failed step, for the first useful page state. */
export function workflowJobLandingSelection(
  jobExecution: JobExecution | undefined,
): WorkflowJobLandingSelection | undefined {
  if (!jobExecution) return undefined;

  const entries = orderedStepAttempts(jobExecution);
  const running = [...entries].reverse().find((entry) => entry.attempt.status === 'running');
  const failedStep = [...jobExecution.steps]
    .sort(compareSteps)
    .find((step) => step.status === 'failed');
  const failedAttempt = failedStep ? resolveStepAttempt(failedStep, undefined) : undefined;
  const failed =
    failedStep && failedAttempt ? {step: failedStep, attempt: failedAttempt} : undefined;
  const selected = running ?? failed;
  return selected ? {stepId: selected.step.id, attemptId: selected.attempt.id} : undefined;
}

function findStep(job: Job, stepId: string): Step | undefined {
  for (const execution of job.jobExecutions) {
    const step = execution.steps.find((candidate) => candidate.id === stepId);
    if (step) return step;
  }
  return undefined;
}

function orderedStepAttempts(jobExecution: JobExecution) {
  return [...jobExecution.steps]
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    .flatMap((step) =>
      [...step.attempts].sort(compareStepAttempts).map((attempt) => ({step, attempt})),
    );
}

function compareSteps(left: Step, right: Step): number {
  return left.position - right.position || left.id.localeCompare(right.id);
}
