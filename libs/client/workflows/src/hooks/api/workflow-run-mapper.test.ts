import {workflowStepAttemptDto, workflowStepDto} from '#test/fixtures/workflow-run.js';
import {toStep} from './workflow-run-mapper.js';

describe('workflow run step error mapping', () => {
  test('preserves managed-provider metadata from a historical attempt', () => {
    const error = mappedAttemptError('agent', {
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
      expect(mappedAttemptError(type, {message: 'Checkout failed', reason})).toMatchObject({
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
    expect(
      mappedAttemptError(type, {message: 'Command failed', reason: 'config_unresolvable'}),
    ).toMatchObject({reason: 'config_unresolvable', category});
  });

  test.each([
    'execution_payload_too_large',
    'step_result_too_large',
  ] as const)('preserves bounded failure reason %s', (reason) => {
    expect(
      mappedAttemptError('run', {
        message: 'Bounded workflow value exceeded its limit',
        reason,
      }),
    ).toMatchObject({reason, category: 'user'});
  });

  test('normalizes historical size fields once at the API boundary', () => {
    const error = mappedAttemptError('run', {
      message: 'Resolved configuration exceeds execution payload limit',
      reason: 'execution_payload_too_large',
      field: 'resolved_config',
      retryable: false,
      limitBytes: 65_536,
      limit_bytes: 0,
      measured_bytes: -5,
      overshoot_bytes: Number.POSITIVE_INFINITY,
    });

    expect(error).toMatchObject({
      field: 'resolved_config',
      retryable: false,
      limitBytes: 65_536,
    });
    expect(error).not.toHaveProperty('measuredBytes');
    expect(error).not.toHaveProperty('overshootBytes');
  });

  test('keeps zero byte counts consistent across current and historical errors', () => {
    const current = toStep(
      workflowStepDto({
        type: 'run',
        error: {
          message: 'Payload failed',
          reason: 'execution_payload_too_large',
          measured_bytes: 0,
        },
      }),
    ).error;
    const historical = mappedAttemptError('run', {
      message: 'Payload failed',
      reason: 'execution_payload_too_large',
      measured_bytes: 0,
    });

    expect(current?.measuredBytes).toBe(0);
    expect(historical?.measuredBytes).toBe(0);
  });
});

function mappedAttemptError(type: string, error: Record<string, unknown>) {
  const step = toStep(
    workflowStepDto({
      type,
      error: null,
      attempts: [workflowStepAttemptDto({error})],
    }),
  );
  return step.attempts[0]?.stepError ?? null;
}
