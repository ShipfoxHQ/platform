import {
  AgentConfigUnresolvableError,
  DefinitionNotFoundError,
  InvalidJobRunnerLabelsError,
  isPermanentRunWorkflowError,
  JobOutputTooLargeError,
  ProjectMismatchError,
} from './errors.js';

describe('isPermanentRunWorkflowError', () => {
  test('is true for a deleted definition', () => {
    const result = isPermanentRunWorkflowError(new DefinitionNotFoundError('def-1'));

    expect(result).toBe(true);
  });

  test('is true for a project mismatch', () => {
    const result = isPermanentRunWorkflowError(new ProjectMismatchError('proj-a', 'proj-b'));

    expect(result).toBe(true);
  });

  test('is true for unresolvable agent configuration', () => {
    const result = isPermanentRunWorkflowError(new AgentConfigUnresolvableError('def-1'));

    expect(result).toBe(true);
  });

  test('is true for invalid job runner labels', () => {
    const result = isPermanentRunWorkflowError(new InvalidJobRunnerLabelsError(['has space']));

    expect(result).toBe(true);
  });

  test('is false for a plain error treated as transient', () => {
    const result = isPermanentRunWorkflowError(new Error('database unavailable'));

    expect(result).toBe(false);
  });

  test('is false for a non-error thrown value', () => {
    const result = isPermanentRunWorkflowError('boom');

    expect(result).toBe(false);
  });
});

describe('JobOutputTooLargeError', () => {
  test('reports per-value measurements and overshoot', () => {
    const error = new JobOutputTooLargeError('payload', 100, 150, 'value');

    expect(error.name).toBe('JobOutputTooLargeError');
    expect(error.overshootBytes).toBe(50);
    expect(error.message).toContain('measured 150 bytes; overshoot 50 bytes');
  });

  test('reports total measurements and overshoot', () => {
    const error = new JobOutputTooLargeError('payload', 100, 175, 'total');

    expect(error.overshootBytes).toBe(75);
    expect(error.message).toContain('measured 175 bytes; overshoot 75 bytes');
  });
});
