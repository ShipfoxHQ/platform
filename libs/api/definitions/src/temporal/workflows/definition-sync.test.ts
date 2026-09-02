import {ActivityFailure, ApplicationFailure, RetryState} from '@temporalio/common';
import {classifyWorkflowError} from './definition-sync.js';

describe('definitionSyncWorkflow error classification', () => {
  it('unwraps activity application failures before persisting sync failure metadata', () => {
    const cause = ApplicationFailure.nonRetryable(
      'Invalid workflow definition at .shipfox/workflows/bad.yml',
      'invalid-definition',
    );
    const error = new ActivityFailure(
      'Activity failed',
      'fetchAndApplyDefinitionWorkflows',
      'activity-id',
      RetryState.NON_RETRYABLE_FAILURE,
      'worker',
      cause,
    );

    const result = classifyWorkflowError(error);

    expect(result).toEqual({
      code: 'invalid-definition',
      message: 'Invalid workflow definition at .shipfox/workflows/bad.yml',
    });
  });

  it('classifies a bare ApplicationFailure using its type', () => {
    const error = ApplicationFailure.retryable('GitHub request timed out', 'provider-timeout');

    const result = classifyWorkflowError(error);

    expect(result).toEqual({
      code: 'provider-timeout',
      message: 'GitHub request timed out',
    });
  });

  it('carries structured diagnostics from an ApplicationFailure', () => {
    const diagnostics = [
      {
        code: 'invalid-definition',
        message: 'Step gate success must be a valid CEL boolean expression.: No such key',
        path: 'jobs.build.steps.0.gate.success',
        severity: 'error' as const,
      },
    ];
    const error = ApplicationFailure.nonRetryable(
      'Invalid workflow definition',
      'invalid-definition',
      diagnostics,
    );

    const result = classifyWorkflowError(error);

    expect(result).toEqual({
      code: 'invalid-definition',
      message: 'Invalid workflow definition',
      diagnostics,
    });
  });

  it('falls back to unknown when ApplicationFailure.type is not a known sync error code', () => {
    const error = ApplicationFailure.nonRetryable('boom', 'something-unexpected');

    const result = classifyWorkflowError(error);

    expect(result).toEqual({
      code: 'unknown',
      message: 'boom',
    });
  });

  it('classifies non-temporal errors as unknown and preserves the message', () => {
    const error = new Error('connection reset');

    const result = classifyWorkflowError(error);

    expect(result).toEqual({
      code: 'unknown',
      message: 'connection reset',
    });
  });
});
