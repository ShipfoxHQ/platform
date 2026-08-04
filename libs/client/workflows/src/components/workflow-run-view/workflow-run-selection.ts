import {
  type Job,
  type JobExecution,
  resolveJobExecution,
  type Step,
  type StepAttempt,
  type WorkflowRunDetail,
} from '#core/workflow-run.js';
import type {WorkflowRunSelectionInput} from '#core/workflow-run-url-state.js';

export interface ResolvedWorkflowRunSelection {
  job: Job | undefined;
  jobExecution: JobExecution | undefined;
  step: Step | undefined;
  attempt: StepAttempt | undefined;
  selectedAttemptId: string | null;
}

export function resolveWorkflowRunSelection({
  run,
  selection,
}: {
  run: WorkflowRunDetail;
  selection: WorkflowRunSelectionInput;
}): ResolvedWorkflowRunSelection {
  const jobById = new Map(run.jobs.map((job) => [job.id, job]));
  const stepMatch = findStep(run, selection.stepId);
  const jobExecutionMatch = findJobExecution(run, selection.jobExecutionId);
  const stepAttemptMatch = findStepAttempt(run, selection.stepAttemptId);

  if (stepMatch) {
    const attempt = resolveStepAttempt(stepMatch.step, selection.stepAttemptId);
    return {
      job: stepMatch.job,
      jobExecution: stepMatch.jobExecution,
      step: stepMatch.step,
      attempt,
      selectedAttemptId: attempt?.id ?? null,
    };
  }

  if (stepAttemptMatch) {
    return {
      job: stepAttemptMatch.job,
      jobExecution: stepAttemptMatch.jobExecution,
      step: stepAttemptMatch.step,
      attempt: stepAttemptMatch.attempt,
      selectedAttemptId: stepAttemptMatch.attempt.id,
    };
  }

  const job =
    (selection.jobId ? jobById.get(selection.jobId) : undefined) ??
    jobExecutionMatch?.job ??
    run.jobs.at(0);
  const jobExecution = job ? resolveJobExecution(job, selection.jobExecutionId) : undefined;

  return {
    job,
    jobExecution,
    step: undefined,
    attempt: undefined,
    selectedAttemptId: null,
  };
}

function findJobExecution(
  run: WorkflowRunDetail,
  jobExecutionId: string | undefined,
): {job: Job; jobExecution: JobExecution} | undefined {
  if (!jobExecutionId) return undefined;

  for (const job of run.jobs) {
    const jobExecution = job.jobExecutions.find((candidate) => candidate.id === jobExecutionId);
    if (jobExecution) return {job, jobExecution};
  }

  return undefined;
}

function findStepAttempt(
  run: WorkflowRunDetail,
  stepAttemptId: string | undefined,
): {job: Job; jobExecution: JobExecution; step: Step; attempt: StepAttempt} | undefined {
  if (!stepAttemptId) return undefined;

  for (const job of run.jobs) {
    for (const jobExecution of job.jobExecutions) {
      for (const step of jobExecution.steps) {
        const attempt = step.attempts.find((candidate) => candidate.id === stepAttemptId);
        if (attempt) return {job, jobExecution, step, attempt};
      }
    }
  }

  return undefined;
}

function findStep(
  run: WorkflowRunDetail,
  stepId: string | undefined,
): {job: Job; jobExecution: JobExecution; step: Step} | undefined {
  if (!stepId) return undefined;

  for (const job of run.jobs) {
    for (const jobExecution of job.jobExecutions) {
      const step = jobExecution.steps.find((candidate) => candidate.id === stepId);
      if (step) return {job, jobExecution, step};
    }
  }

  return undefined;
}

function resolveStepAttempt(step: Step, attemptId: string | undefined): StepAttempt | undefined {
  const attemptById = attemptId
    ? step.attempts.find((attempt) => attempt.id === attemptId)
    : undefined;
  if (attemptById) return attemptById;

  const currentAttempt = step.attempts.find((attempt) => attempt.attempt === step.currentAttempt);
  if (currentAttempt) return currentAttempt;

  return step.attempts.reduce<StepAttempt | undefined>((latest, attempt) => {
    if (!latest) return attempt;
    return compareAttempts(attempt, latest) > 0 ? attempt : latest;
  }, undefined);
}

function compareAttempts(left: StepAttempt, right: StepAttempt): number {
  return (
    left.attempt - right.attempt ||
    left.executionOrder - right.executionOrder ||
    left.id.localeCompare(right.id)
  );
}
