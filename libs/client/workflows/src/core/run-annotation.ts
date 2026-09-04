import type {JobStatusReason} from './entities/job.js';
import type {EvaluationTraceEntry} from './entities/step-attempt.js';

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
  jobName: string;
  jobPosition: number;
  executionSequence: number;
  /** Only set when the job ran more than once, so a single-execution job stays uncluttered. */
  executionLabel: string | null;
  stepLabel: string;
  attemptLabel: string;
  /** `null` when the emitting step attempt has not been created, so no link is offered. */
  origin: RunAnnotationOrigin | null;
}

export interface RunJobExplanation {
  jobId: string;
  jobName: string;
  jobPosition: number;
  status: 'failed' | 'skipped';
  statusReason: JobStatusReason | null;
  evaluationTrace: EvaluationTraceEntry[] | null;
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
  entries: readonly RunAnnotationEntry[];
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
  entries,
  severity,
  jobId,
}: BuildRunAnnotationListInput): RunAnnotationEntry[] {
  const visible: RunAnnotationEntry[] = [];

  for (const entry of entries) {
    if (jobId && entry.annotation.jobId !== jobId) continue;
    const annotationSeverityValue = annotationSeverity(entry.annotation.style);
    if (severity && annotationSeverityValue !== severity) continue;
    visible.push(entry);
  }

  return visible.sort(compareEntries);
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

function compareEntries(left: RunAnnotationEntry, right: RunAnnotationEntry): number {
  const bySeverity = SEVERITY_RANK[left.annotation.style] - SEVERITY_RANK[right.annotation.style];
  if (bySeverity !== 0) return bySeverity;

  const byJob = left.jobPosition - right.jobPosition;
  if (byJob !== 0) return byJob;

  const byExecution = left.executionSequence - right.executionSequence;
  if (byExecution !== 0) return byExecution;

  const bySequence = left.annotation.sequence - right.annotation.sequence;
  if (bySequence !== 0) return bySequence;

  return left.annotation.id.localeCompare(right.annotation.id);
}
