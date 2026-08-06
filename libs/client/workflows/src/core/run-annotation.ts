import type {Job} from './workflow-run.js';

export type RunAnnotationStyle = 'default' | 'info' | 'success' | 'warning' | 'error';

/**
 * The severities the run surfaces rank and filter by. The `default` style carries no severity:
 * it counts toward the total and sorts last, but no severity filter selects it.
 */
export const RUN_ANNOTATION_SEVERITIES = ['error', 'warning', 'info', 'success'] as const;

export type RunAnnotationSeverity = (typeof RUN_ANNOTATION_SEVERITIES)[number];

const SEVERITY_RANK: Record<RunAnnotationStyle, number> = {
  error: 0,
  warning: 1,
  info: 2,
  success: 3,
  default: 4,
};

const SEVERITY_SET = new Set<string>(RUN_ANNOTATION_SEVERITIES);

export interface RunAnnotation {
  id: string;
  jobId: string;
  jobExecutionId: string;
  originStepId: string;
  originStepAttempt: number;
  context: string;
  style: RunAnnotationStyle;
  sequence: number;
}

export interface RunAnnotationRecord extends RunAnnotation {
  body: string;
}

/** Counts shown by the run rail and the severity summary line. */
export interface RunAnnotationSummary {
  total: number;
  error: number;
  warning: number;
  info: number;
  success: number;
  /** True when the read hit its page budget, so every count is a lower bound. */
  truncated: boolean;
  /** Optional per-step counts used by the step inspector without loading annotation bodies. */
  stepCounts?: readonly {
    stepId: string;
    attempt: number;
    total: number;
  }[];
}

/** Everything the annotations list needs to route back to the step that emitted an annotation. */
export interface RunAnnotationOrigin {
  jobId: string;
  jobExecutionId: string;
  stepId: string;
  stepAttemptId: string;
}

export interface RunAnnotationEntry {
  annotation: RunAnnotationRecord;
  jobName: string | null;
  /** Only set when the job ran more than once, so a single-execution job stays uncluttered. */
  executionLabel: string | null;
  stepLabel: string | null;
  attemptLabel: string;
  /** `null` when the run attempt no longer contains the emitting step, so no link is offered. */
  origin: RunAnnotationOrigin | null;
}

export function annotationSeverity(style: RunAnnotationStyle): RunAnnotationSeverity | null {
  return SEVERITY_SET.has(style) ? (style as RunAnnotationSeverity) : null;
}

export function summarizeRunAnnotations(
  annotations: readonly RunAnnotation[],
  {truncated = false}: {truncated?: boolean | undefined} = {},
): RunAnnotationSummary {
  const summary: RunAnnotationSummary = {
    total: annotations.length,
    error: 0,
    warning: 0,
    info: 0,
    success: 0,
    truncated,
  };

  for (const annotation of annotations) {
    const severity = annotationSeverity(annotation.style);
    if (severity) summary[severity] += 1;
  }

  return summary;
}

export interface BuildRunAnnotationListInput {
  annotations: readonly RunAnnotationRecord[];
  jobs: readonly Job[];
  severity?: RunAnnotationSeverity | undefined;
  jobId?: string | undefined;
}

/**
 * Ranks annotations for display.
 *
 * Severity leads: emission order is a log affordance, not a summary affordance. `sequence` is
 * only stable within one job execution, so the tie-break walks down job position and execution
 * sequence before using it, and ends on the id so the order never depends on input order.
 */
export function buildRunAnnotationList({
  annotations,
  jobs,
  severity,
  jobId,
}: BuildRunAnnotationListInput): RunAnnotationEntry[] {
  const index = indexJobs(jobs);
  const entries: RunAnnotationEntry[] = [];

  for (const annotation of annotations) {
    if (jobId && annotation.jobId !== jobId) continue;
    const annotationSeverityValue = annotationSeverity(annotation.style);
    if (severity && annotationSeverityValue !== severity) continue;
    entries.push(toEntry(annotation, index));
  }

  return entries.sort((left, right) => compareEntries(left, right, index));
}

/** Counts annotations owned by one job, for the job page's bounded reference chip. */
export function summarizeJobAnnotations(
  annotations: readonly RunAnnotation[],
  jobId: string,
  options: {truncated?: boolean | undefined} = {},
): RunAnnotationSummary {
  return summarizeRunAnnotations(
    annotations.filter((annotation) => annotation.jobId === jobId),
    options,
  );
}

/** The loudest severity present, which tints a count chip. */
export function highestRunAnnotationSeverity(
  summary: RunAnnotationSummary,
): RunAnnotationSeverity | null {
  return RUN_ANNOTATION_SEVERITIES.find((severity) => summary[severity] > 0) ?? null;
}

interface JobIndexEntry {
  position: number;
  name: string;
  executionCount: number;
  executions: Map<string, JobExecutionIndexEntry>;
}

interface JobExecutionIndexEntry {
  sequence: number;
  steps: Map<string, {label: string; attemptIds: Map<number, string>}>;
}

function indexJobs(jobs: readonly Job[]): Map<string, JobIndexEntry> {
  const index = new Map<string, JobIndexEntry>();

  for (const job of jobs) {
    const executions = new Map<string, JobExecutionIndexEntry>();
    for (const execution of job.jobExecutions) {
      const steps = new Map<string, {label: string; attemptIds: Map<number, string>}>();
      for (const step of execution.steps) {
        const attemptIds = new Map<number, string>();
        for (const attempt of step.attempts) attemptIds.set(attempt.attempt, attempt.id);
        steps.set(step.id, {label: step.name || step.key || step.id, attemptIds});
      }
      executions.set(execution.id, {sequence: execution.sequence, steps});
    }

    index.set(job.id, {
      position: job.position,
      name: job.displayName,
      executionCount: job.jobExecutions.length,
      executions,
    });
  }

  return index;
}

function toEntry(
  annotation: RunAnnotationRecord,
  index: Map<string, JobIndexEntry>,
): RunAnnotationEntry {
  const job = index.get(annotation.jobId);
  const execution = job?.executions.get(annotation.jobExecutionId);
  const step = execution?.steps.get(annotation.originStepId);
  const stepAttemptId = step?.attemptIds.get(annotation.originStepAttempt);

  return {
    annotation,
    jobName: job?.name ?? null,
    executionLabel:
      execution && job && job.executionCount > 1 ? `execution #${execution.sequence}` : null,
    stepLabel: step?.label ?? null,
    attemptLabel: `attempt ${annotation.originStepAttempt}`,
    origin: stepAttemptId
      ? {
          jobId: annotation.jobId,
          jobExecutionId: annotation.jobExecutionId,
          stepId: annotation.originStepId,
          stepAttemptId,
        }
      : null,
  };
}

function compareEntries(
  left: RunAnnotationEntry,
  right: RunAnnotationEntry,
  index: Map<string, JobIndexEntry>,
): number {
  const bySeverity = SEVERITY_RANK[left.annotation.style] - SEVERITY_RANK[right.annotation.style];
  if (bySeverity !== 0) return bySeverity;

  const byJob = jobPosition(left, index) - jobPosition(right, index);
  if (byJob !== 0) return byJob;

  const byExecution = executionSequence(left, index) - executionSequence(right, index);
  if (byExecution !== 0) return byExecution;

  const bySequence = left.annotation.sequence - right.annotation.sequence;
  if (bySequence !== 0) return bySequence;

  return left.annotation.id.localeCompare(right.annotation.id);
}

/** An unmatched job sorts last rather than first, so known provenance leads the list. */
function jobPosition(entry: RunAnnotationEntry, index: Map<string, JobIndexEntry>): number {
  return index.get(entry.annotation.jobId)?.position ?? Number.MAX_SAFE_INTEGER;
}

function executionSequence(entry: RunAnnotationEntry, index: Map<string, JobIndexEntry>): number {
  const job = index.get(entry.annotation.jobId);
  return job?.executions.get(entry.annotation.jobExecutionId)?.sequence ?? Number.MAX_SAFE_INTEGER;
}
