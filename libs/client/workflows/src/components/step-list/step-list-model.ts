import {
  getWorkflowStatusVisual,
  type WorkflowStatusVisual,
} from '#components/workflow-status/status-visuals.js';
import {
  defaultJobExecution,
  isWorkflowStatus as isKnownWorkflowStatus,
  type Job,
  JobExecution,
  type Step,
  type StepAttempt,
  type StepAttemptDisplayDuration,
} from '#core/workflow-run.js';

export interface StepStatusVisual extends Omit<WorkflowStatusVisual, 'kind'> {
  kind: string;
  ripple: boolean;
}

export interface StepAttemptModel extends StepAttempt {
  displayDuration: StepAttemptDisplayDuration | null;
  statusVisual: StepStatusVisual;
  carriedOver: boolean;
}

export interface StepModel extends Omit<Step, 'attempts'> {
  index: number;
  label: string;
  attempts: StepAttemptModel[];
}

export interface StepListEntryModel extends StepAttemptModel {
  step: StepModel;
}

export interface StepListModel {
  jobId: string;
  jobName: string;
  jobExecutionId: string;
  stepCount: number;
  activeEntryId: string | undefined;
  entries: StepListEntryModel[];
}

export function buildStepListModel({
  job,
  jobExecution,
}: {
  job: Job;
  jobExecution?: JobExecution | undefined;
}): StepListModel {
  const selectedJobExecution = jobExecution ?? defaultStepListJobExecution(job);
  const steps = [...selectedJobExecution.steps].sort(compareSteps).map(toStepModel);
  const entries = steps
    .flatMap((step) => toStepEntries(step, job.carriedOver))
    .sort(compareEntries);

  return {
    jobId: job.id,
    jobName: job.name ?? job.key,
    jobExecutionId: selectedJobExecution.id,
    stepCount: steps.length,
    activeEntryId: landingEntryId(entries),
    entries,
  };
}

export function defaultStepListJobExecution(job: Job): JobExecution {
  return defaultJobExecution(job) ?? emptyJobExecutionForJob(job);
}

export function emptyJobExecutionForJob(job: Job): JobExecution {
  return new JobExecution({
    id: `missing:${job.id}`,
    jobId: job.id,
    sequence: 1,
    name: job.name ?? job.key,
    status: job.status === 'skipped' ? 'cancelled' : job.status,
    statusReason: job.statusReason,
    statusReasonMessage: null,
    runner: job.runner,
    outputs: job.outputs,
    triggerEvents: [],
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    timedOutAt: null,
    evaluationTrace: job.evaluationTrace,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    steps: [],
  });
}

export function getStepStatusVisual(status: string): StepStatusVisual {
  const normalized = normalizeStatus(status);

  if (isKnownWorkflowStatus(normalized)) {
    const visual = getWorkflowStatusVisual(normalized);
    return {...visual, ripple: normalized === 'running'};
  }

  return {
    kind: status,
    label: humanizeStatus(status),
    dot: 'neutral',
    badge: 'neutral',
    ripple: false,
  };
}

export function humanizeStatus(status: string): string {
  const words = status.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  if (!words) return 'Unknown';
  const firstLetter = words.at(0);
  return firstLetter === undefined ? 'Unknown' : firstLetter.toUpperCase() + words.slice(1);
}

function toStepModel(step: Step, index: number): StepModel {
  const attempts = [...step.attempts].sort(compareAttempts).map((attempt) => ({
    ...attempt,
    displayDuration: attempt.displayDuration,
    statusVisual: getStepStatusVisual(attempt.status),
    carriedOver: false,
  }));

  return {
    ...step,
    index: index + 1,
    label: stepLabel(step, index),
    attempts,
  };
}

function stepLabel(step: Step, index: number): string {
  const name = step.name.trim();
  if (name) return name;

  const key = step.key?.trim();
  if (key) return key;

  return `Step ${index + 1}`;
}

function toStepEntries(step: StepModel, carriedOverJob: boolean): StepListEntryModel[] {
  if (step.attempts.length > 0) {
    return step.attempts.map((attempt) => ({
      ...attempt,
      step,
    }));
  }

  if (!carriedOverJob) return [];

  return [
    {
      id: `carried-over:${step.id}`,
      stepId: step.id,
      jobExecutionId: step.jobExecutionId,
      attempt: step.currentAttempt,
      executionOrder: step.position,
      status: step.status,
      exitCode: null,
      output: null,
      outputs: null,
      response: null,
      error: null,
      gateResult: null,
      restartFeedback: null,
      startedAt: step.createdAt,
      finishedAt: null,
      displayDuration: null,
      statusVisual: getStepStatusVisual(step.status),
      carriedOver: true,
      step,
    },
  ];
}

function compareSteps(left: Step, right: Step): number {
  return (
    left.position - right.position ||
    (left.name ?? '').localeCompare(right.name ?? '') ||
    left.id.localeCompare(right.id)
  );
}

function compareAttempts(left: Step['attempts'][number], right: Step['attempts'][number]) {
  return left.attempt - right.attempt || left.id.localeCompare(right.id);
}

function compareEntries(left: StepListEntryModel, right: StepListEntryModel): number {
  return (
    left.executionOrder - right.executionOrder ||
    left.step.index - right.step.index ||
    left.attempt - right.attempt ||
    left.id.localeCompare(right.id)
  );
}

function landingEntryId(entries: readonly StepListEntryModel[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.statusVisual.kind === 'running') return entry.id;
  }
  return undefined;
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase().replace(/-/g, '_');
}
