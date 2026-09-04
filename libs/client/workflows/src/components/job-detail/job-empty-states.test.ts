import {
  workflowJob,
  workflowJobExecutionDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {
  emptyStateForJob,
  emptyStateForMissingExecution,
  jobSucceededSummary,
  outputFailureDescriptionForExecution,
  skippedJobDescription,
} from './job-empty-states.js';

describe('jobSucceededSummary', () => {
  test('counts only succeeded steps when skipped steps are present', () => {
    const job = workflowJob({
      status: 'succeeded',
      job_executions: [
        workflowJobExecutionDto({
          status: 'succeeded',
          steps: [
            workflowStepDto({status: 'succeeded'}),
            workflowStepDto({status: 'skipped', position: 1}),
          ],
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    expect(jobSucceededSummary(job, execution)).toBe('1 step succeeded');
  });
});

describe('skippedJobDescription', () => {
  test('explains when materialized output exceeds the configured size limit', () => {
    expect(skippedJobDescription('output_too_large')).toBe(
      'The materialized job output exceeded its configured size limit.',
    );
  });
});

describe('materialized output failure descriptions', () => {
  const fallback =
    'A materialized job output could not be persisted: it exceeded a size or entry cap, contained a non-JSON-safe value, or referenced an unresolved value. Check the output mapping and values before re-running the workflow.';

  test('uses the server-authored message for an execution with recorded steps', () => {
    const job = workflowJob({
      status: 'failed',
      status_reason: 'output_invalid',
      job_executions: [
        workflowJobExecutionDto({
          status: 'failed',
          status_reason: 'output_invalid',
          status_reason_message: 'Job output "payload" cannot be persisted as JSON: undefined.',
          steps: [workflowStepDto({status: 'succeeded'})],
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    expect(outputFailureDescriptionForExecution(execution)).toBe(
      'Job output "payload" cannot be persisted as JSON: undefined.',
    );
  });

  test('keeps the generic fallback for old output-invalid rows without a message', () => {
    const job = workflowJob({
      status: 'failed',
      status_reason: 'output_invalid',
      job_executions: [
        workflowJobExecutionDto({
          status: 'failed',
          status_reason: 'output_invalid',
          steps: [workflowStepDto({status: 'succeeded'})],
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    expect(outputFailureDescriptionForExecution(execution)).toBe(fallback);
  });

  test('uses the message in the empty state when output materialization failed before steps', () => {
    const job = workflowJob({
      status: 'failed',
      status_reason: 'output_invalid',
      job_executions: [
        workflowJobExecutionDto({
          status: 'failed',
          status_reason: 'output_invalid',
          status_reason_message: 'Job outputs cannot define more than 10 entries (found 11)',
          steps: [],
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    expect(emptyStateForJob(job, execution)).toMatchObject({
      description: 'Job outputs cannot define more than 10 entries (found 11)',
    });
  });

  test('identifies a legacy trigger payload failure before the first step', () => {
    const job = workflowJob({
      status: 'failed',
      status_reason: 'output_too_large',
      job_executions: [
        workflowJobExecutionDto({
          status: 'failed',
          status_reason: 'output_too_large',
          status_reason_message:
            'Workflow diagnostic field "trigger_events" exceeds the size limit of 65536 bytes (measured 97834 bytes; overshoot 32298 bytes).',
          steps: [],
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    const emptyState = emptyStateForJob(job, execution);
    expect(emptyState).toMatchObject({
      title: 'Trigger events exceeded a legacy payload limit',
      description:
        'The trigger events for this execution exceeded a legacy payload limit. Re-running failed jobs preserves the same events, so reduce the listener batch or start a new run from a smaller event payload.',
    });
    expect(emptyState?.description).not.toContain('job output');
  });

  test('keeps bounded fallback copy for old output failures without a message', () => {
    const job = workflowJob({
      status: 'failed',
      status_reason: 'output_too_large',
      job_executions: [
        workflowJobExecutionDto({
          status: 'failed',
          status_reason: 'output_too_large',
          status_reason_message: null,
          steps: [],
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    expect(emptyStateForJob(job, execution)).toMatchObject({
      title: 'Job failed before its first step started',
      description:
        'The materialized job output exceeded its configured size limit. Review the failure details before re-running the workflow.',
    });
  });

  test('keeps output failures scoped to the selected execution', () => {
    const job = workflowJob({
      status: 'failed',
      status_reason: 'output_invalid',
      job_executions: [
        workflowJobExecutionDto({
          status: 'succeeded',
          status_reason: null,
          steps: [workflowStepDto({status: 'succeeded'})],
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    expect(outputFailureDescriptionForExecution(execution)).toBeUndefined();
    expect(
      emptyStateForMissingExecution(
        workflowJob({status: 'failed', status_reason: 'output_invalid'}),
      ),
    ).toMatchObject({
      description: fallback,
    });
  });
});
