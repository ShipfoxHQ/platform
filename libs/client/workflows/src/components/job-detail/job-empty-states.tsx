import {Callout, CalloutContent, CalloutDescription, CalloutTitle} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import type {Job, JobExecution, Step, StepError} from '#core/workflow-run.js';
import {deriveJobDisplayStatus, deriveJobExecutionDisplayStatus} from '#core/workflow-run.js';
import type {StepListEmptyState} from '../step-list/index.js';
import {formatJobExecutionTime} from './job-execution-time-text.js';

const MATERIALIZED_OUTPUT_FAILURE_DESCRIPTION =
  'A materialized job output could not be persisted: it exceeded a size or entry cap, contained a non-JSON-safe value, or referenced an unresolved value. Check the output mapping and values before re-running the workflow.';
const OUTPUT_TOO_LARGE_FAILURE_DESCRIPTION =
  'The materialized job output exceeded its configured size limit. Review the failure details before re-running the workflow.';
const LEGACY_TRIGGER_PAYLOAD_FAILURE_DESCRIPTION =
  'The trigger events for this execution exceeded a legacy payload limit. Re-running failed jobs preserves the same events, so reduce the listener batch or start a new run from a smaller event payload.';
const LEGACY_DIAGNOSTIC_FIELD_RE = /^Workflow diagnostic field "([^"]+)"/u;

export function outputFailureDescriptionForExecution(
  jobExecution: JobExecution,
): string | undefined {
  if (jobExecution.steps.length === 0) return undefined;

  if (jobExecution.statusReason === 'output_invalid') {
    return jobExecution.statusReasonMessage || MATERIALIZED_OUTPUT_FAILURE_DESCRIPTION;
  }
  if (jobExecution.statusReason === 'output_too_large') {
    return jobExecution.statusReasonMessage || OUTPUT_TOO_LARGE_FAILURE_DESCRIPTION;
  }
  return undefined;
}

export function MaterializedOutputFailureNotice({jobExecution}: {jobExecution: JobExecution}) {
  const description = outputFailureDescriptionForExecution(jobExecution);
  if (!description) return null;

  return (
    <Callout
      role="alert"
      type="error"
      variant="secondary"
      className="border-b border-border-neutral-base px-row py-row"
    >
      <CalloutContent>
        <CalloutTitle>Job output could not be persisted</CalloutTitle>
        <CalloutDescription>{description}</CalloutDescription>
      </CalloutContent>
    </Callout>
  );
}

export function emptyStateForJob(
  job: Job,
  jobExecution: JobExecution,
): StepListEmptyState | undefined {
  if (job.carriedOver) {
    return {
      title: 'Carried over from a previous attempt',
      description: 'This job did not execute in this run.',
      status: 'succeeded',
    };
  }

  const displayStatus =
    job.mode === 'listening'
      ? deriveJobExecutionDisplayStatus(jobExecution)
      : deriveJobDisplayStatus(job);
  const runner = jobExecution.runner?.length ? jobExecution.runner : job.runner;

  if (jobExecution.status === 'running' && displayStatus === 'pending') {
    return {
      title: runner?.length ? 'Runner preparing job' : 'Waiting for a runner',
      description: runner?.length
        ? `Runner ${runner.join(', ')} is preparing the job. Steps will appear here when work begins.`
        : 'No runner has claimed this job yet. Steps will appear here when a runner starts work.',
      status: displayStatus,
    };
  }

  if (displayStatus === 'pending') {
    return {
      title: 'Waiting for this job to start',
      description: 'Steps will appear here once the job starts.',
      status: displayStatus,
    };
  }

  if (displayStatus === 'running') {
    return {
      title: 'Waiting for the first step',
      description: 'The first running step will appear here shortly.',
      status: displayStatus,
    };
  }

  if (displayStatus === 'cancelled') {
    return {
      title: 'Cancelled before start',
      description: 'This job was cancelled before any step started.',
      status: displayStatus,
    };
  }

  if (displayStatus === 'failed') {
    const reason = jobExecution.statusReason ?? job.statusReason;
    return {
      title: preStepFailureTitle(reason, jobExecution.statusReasonMessage),
      description: preStepFailureDescription(reason, runner, jobExecution.statusReasonMessage),
      status: displayStatus,
    };
  }

  if (displayStatus === 'succeeded') {
    return {
      title: 'Completed without recorded steps',
      description: `Execution #${jobExecution.sequence} succeeded before any step output was recorded.`,
      status: displayStatus,
    };
  }

  return undefined;
}

export function emptyStateForMissingExecution(job: Job): StepListEmptyState {
  if (job.carriedOver) {
    return {
      title: 'Carried over from a previous attempt',
      description: 'This job did not execute in this run.',
      status: 'succeeded',
    };
  }

  if (job.mode === 'listening' && job.listenerStatus === 'listening') {
    return {
      title: 'Waiting for trigger events',
      description: 'Matching trigger events will create job executions here.',
      status: deriveJobDisplayStatus(job),
    };
  }

  if (job.mode === 'listening' && job.listenerStatus === 'resolved') {
    return {
      title: 'Listener resolved without executions',
      description: 'No matching trigger event created a job execution before the listener stopped.',
      status: job.status,
    };
  }

  if (job.status === 'pending') {
    return {
      title: 'Waiting for this job to start',
      description: 'No execution has been created for this job yet.',
      status: 'pending',
    };
  }

  if (job.status === 'skipped') {
    return {
      title: 'This job was skipped',
      description: skippedJobDescription(job.statusReason),
      status: 'skipped',
    };
  }

  if (job.status === 'cancelled') {
    return {
      title: 'Cancelled before start',
      description: 'This job was cancelled before an execution was created.',
      status: 'cancelled',
    };
  }

  if (job.status === 'failed') {
    return {
      title: 'Job failed before an execution was created',
      description: preStepFailureDescription(job.statusReason, job.runner),
      status: 'failed',
    };
  }

  return {
    title: 'Execution details unavailable',
    description: 'This job finished, but no job execution record is available.',
    status: job.status,
  };
}

export function skippedJobDescription(reason: Job['statusReason']): string {
  switch (reason) {
    case 'dependency_not_completed':
      return 'A required job did not complete, so this job was skipped.';
    case 'default_gate_rejected':
      return 'A required job did not succeed, so this job was skipped.';
    case 'condition_false':
    case 'condition_rejected':
      return 'The job condition did not match, so this job was skipped.';
    case 'condition_errored':
      return 'The job condition could not be evaluated, so this job was skipped.';
    case 'user_cancelled':
    case 'run_cancelled':
    case 'timed_out':
    case 'runner_lost':
    case 'output_invalid':
    case 'step_failed':
    case 'unknown':
    case null:
      return 'This job did not start.';
    case 'output_too_large':
      return 'The materialized job output exceeded its configured size limit.';
  }
}

function preStepFailureDescription(
  reason: string | null,
  runner: string[] | null = null,
  statusReasonMessage: string | null = null,
): string {
  const runnerCopy = runner?.length ? ` Required runner labels: ${runner.join(', ')}.` : '';

  switch (reason) {
    case 'runner_lost':
      return `The runner stopped responding before work began.${runnerCopy} Check runner availability before re-running the workflow.`;
    case 'timed_out':
      return `The job timed out before work began.${runnerCopy} Check runner capacity and timeout configuration before re-running the workflow.`;
    case 'user_cancelled':
    case 'run_cancelled':
      return 'The execution ended while the run was being cancelled.';
    case 'step_failed':
      return `The execution failed before step details were recorded.${runnerCopy} Review run annotations before re-running the workflow.`;
    case 'output_too_large':
      if (legacyDiagnosticField(statusReasonMessage) === 'trigger_events') {
        return LEGACY_TRIGGER_PAYLOAD_FAILURE_DESCRIPTION;
      }
      return statusReasonMessage || OUTPUT_TOO_LARGE_FAILURE_DESCRIPTION;
    case 'output_invalid':
      return statusReasonMessage || MATERIALIZED_OUTPUT_FAILURE_DESCRIPTION;
    case 'condition_errored':
      return 'The job condition could not be evaluated. Review run annotations before re-running the workflow.';
    case 'dependency_not_completed':
    case 'default_gate_rejected':
      return 'A required job did not complete successfully. Resolve that failure before re-running the workflow.';
    case 'condition_false':
    case 'condition_rejected':
      return 'The job condition did not match, so no work started.';
    case 'unknown':
    case null:
      return `Shipfox did not record a failure reason.${runnerCopy} Re-run only after checking the runner and workflow configuration.`;
    default:
      return `The execution ended because ${humanizeFailureReason(reason)}.${runnerCopy} Resolve that condition before re-running the workflow.`;
  }
}

function preStepFailureTitle(reason: string | null, statusReasonMessage: string | null): string {
  if (
    reason === 'output_too_large' &&
    legacyDiagnosticField(statusReasonMessage) === 'trigger_events'
  ) {
    return 'Trigger events exceeded a legacy payload limit';
  }
  return 'Job failed before its first step started';
}

function legacyDiagnosticField(message: string | null): string | undefined {
  if (!message) return undefined;
  const match = LEGACY_DIAGNOSTIC_FIELD_RE.exec(message);
  return match?.[1];
}

function humanizeFailureReason(reason: string): string {
  return reason.replaceAll('_', ' ').replaceAll('-', ' ');
}

export function CarriedOverStepPanel() {
  return (
    <EmptyState
      className="rounded-8 border border-border-neutral-base bg-background-components-base"
      icon="componentLine"
      title="Carried over from a previous attempt"
      description="Not executed in this run."
      variant="panel"
    />
  );
}

export function isAgentConfigFailure(step: Step, error: StepError | null): boolean {
  return step.type === 'agent' && error?.reason === 'agent_config_invalid';
}

export function jobSucceededSummary(job: Job, execution: JobExecution): string | undefined {
  if (job.carriedOver || execution.status !== 'succeeded') return undefined;
  const stepCount = execution.steps.filter((step) => step.status === 'succeeded').length;
  if (stepCount === 0) return undefined;
  const duration = execution.displayDuration;
  return `${stepCount} step${stepCount === 1 ? '' : 's'} succeeded${duration ? ` in ${formatJobExecutionTime(duration)}` : ''}`;
}
