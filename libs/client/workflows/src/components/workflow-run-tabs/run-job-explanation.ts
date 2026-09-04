import type {RunAnnotationStyle, RunJobExplanation} from '#core/run-annotation.js';

export interface RunJobExplanationPresentation {
  style: RunAnnotationStyle;
  statusLabel: 'Skipped' | 'Failed';
  body: string;
}

const EXPECTED_SKIP_REASONS = new Set<RunJobExplanation['statusReason']>([
  'dependency_not_completed',
  'default_gate_rejected',
  'condition_false',
  'condition_rejected',
  'user_cancelled',
  'run_cancelled',
]);

export function presentRunJobExplanation(
  explanation: RunJobExplanation,
): RunJobExplanationPresentation {
  const traceSummary = formatConditionEvaluation(explanation.evaluationTrace);
  const summary =
    explanation.status === 'skipped'
      ? skippedJobSummary(explanation.statusReason)
      : failedJobSummary(explanation);

  return {
    style: explanationStyle(explanation),
    statusLabel: explanation.status === 'skipped' ? 'Skipped' : 'Failed',
    body: [summary, traceSummary].filter(Boolean).join('\n\n'),
  };
}

function explanationStyle(explanation: RunJobExplanation): RunAnnotationStyle {
  if (explanation.status === 'failed') return 'error';
  return EXPECTED_SKIP_REASONS.has(explanation.statusReason) ? 'default' : 'warning';
}

function skippedJobSummary(reason: RunJobExplanation['statusReason']): string {
  switch (reason) {
    case 'dependency_not_completed':
    case 'default_gate_rejected':
      return 'A required job did not succeed, so this job did not run.';
    case 'condition_false':
    case 'condition_rejected':
      return 'Its condition evaluated to false, so this job did not run.';
    case 'condition_errored':
      return "Shipfox could not evaluate this job's condition. Review the condition and the values it references.";
    case 'user_cancelled':
      return 'This job did not run because it was cancelled.';
    case 'run_cancelled':
      return 'This job did not run because the run was cancelled.';
    case null:
    case 'unknown':
      return 'This job did not run. Shipfox did not record a reason.';
    default:
      return 'This job did not run.';
  }
}

function failedJobSummary(explanation: RunJobExplanation): string {
  const successConditionTrace = explanation.evaluationTrace?.filter(
    (entry) => !('dropped' in entry) && entry.field === 'job.success',
  );

  if (!successConditionTrace?.length && explanation.statusReason === 'step_failed') {
    return 'Its success condition evaluated to false.';
  }
  if (
    !successConditionTrace?.length &&
    explanation.statusReason !== null &&
    explanation.statusReason !== 'unknown'
  ) {
    return 'This job failed without running any work.';
  }
  if (!successConditionTrace?.length) {
    return 'This job failed without running any work. Shipfox did not record a reason.';
  }
  if (successConditionTrace.some((entry) => !('dropped' in entry) && entry.degraded)) {
    return "Shipfox could not evaluate this job's success condition. Review the condition and the values it references.";
  }
  return 'Its success condition evaluated to false.';
}

function formatConditionEvaluation(trace: RunJobExplanation['evaluationTrace']): string | null {
  if (!trace?.length) return null;

  return [
    'Condition evaluation:',
    ...trace.map((entry) => {
      if ('dropped' in entry) {
        return `- ${entry.dropped} additional evaluation${entry.dropped === 1 ? '' : 's'} not recorded`;
      }
      const value =
        entry.value === undefined || entry.value === '' ? '(empty)' : `\`${entry.value}\``;
      return `- \`${entry.field}\` evaluated \`${entry.expression}\` to ${value}${entry.degraded ? ' (degraded)' : ''}`;
    }),
  ].join('\n');
}
