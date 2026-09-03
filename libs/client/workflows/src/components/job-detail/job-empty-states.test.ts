import type {Step} from '#core/workflow-run.js';
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
  toSelectedAttemptError,
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

describe('toSelectedAttemptError', () => {
  test('preserves managed-provider metadata from a historical attempt', () => {
    const error = toSelectedAttemptError({type: 'agent'} as Step, {
      message: 'This instance only supports provider `shipfox`.',
      code: 'workspace-providers-disabled',
      managedProviderId: 'shipfox',
      reason: 'agent_config_invalid',
      agentConfigIssue: 'provider_unsupported',
    });

    expect(error).toMatchObject({
      code: 'workspace-providers-disabled',
      managedProviderId: 'shipfox',
      reason: 'agent_config_invalid',
      agentConfigIssue: 'provider_unsupported',
    });
  });

  test.each([
    'setup',
    'checkout',
    'agent',
    'run',
  ] as const)('derives the error category for %s steps', (type) => {
    for (const reason of [
      'checkout_auth_failed',
      'checkout_unavailable',
      'checkout_failed',
      'checkout_path_invalid',
      'checkout_destination_occupied',
      'git_unavailable',
      'workspace_prep_failed',
      'setup_aborted',
    ] as const) {
      const error = toSelectedAttemptError({type} as Step, {
        message: 'Checkout failed',
        reason,
      });

      expect(error).toMatchObject({
        reason,
        category: 'setup',
      });
    }
  });

  test.each([
    ['setup', 'setup'],
    ['checkout', 'setup'],
    ['agent', 'user'],
    ['run', 'user'],
  ] as const)('keeps config failures in the expected category for %s steps', (type, category) => {
    const error = toSelectedAttemptError({type} as Step, {
      message: 'Command failed',
      reason: 'config_unresolvable',
    });

    expect(error).toMatchObject({reason: 'config_unresolvable', category});
  });

  test.each([
    'execution_payload_too_large',
    'step_result_too_large',
  ] as const)('preserves bounded failure reason %s', (reason) => {
    const error = toSelectedAttemptError({type: 'run'} as Step, {
      message: 'Bounded workflow value exceeded its limit',
      reason,
    });

    expect(error).toMatchObject({reason, category: 'user'});
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
