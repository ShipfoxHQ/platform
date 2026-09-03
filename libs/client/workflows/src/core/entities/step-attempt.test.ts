import {
  isTerminalStepAttemptStatus,
  presentStepAttemptDiagnostics,
  StepAttempt,
  type StepAttemptDetail,
} from './step-attempt.js';

describe('presentStepAttemptDiagnostics', () => {
  test('prefers populated detail fields and falls back to compact values', () => {
    const attempt = compactAttempt();
    const detail = attemptDetail({
      output: {source: 'detail'},
      outputs: {mapped: 'detail'},
      response: 'detail response',
      error: {message: 'detail error'},
      gateResult: {kind: 'failed', passed: false, source: 'exit 1', exitCode: 1},
      restartFeedback: 'detail feedback',
      invocations: [],
    });

    const result = presentStepAttemptDiagnostics(attempt, detail);

    expect(result.output).toEqual({source: 'detail'});
    expect(result.outputs).toEqual({mapped: 'detail'});
    expect(result.response).toBe('detail response');
    expect(result.error).toEqual({message: 'detail error'});
    expect(result.gateResult).toEqual({
      kind: 'failed',
      passed: false,
      source: 'exit 1',
      exitCode: 1,
    });
    expect(result.restartFeedback).toBe('detail feedback');
    expect(result.invocations).toEqual(attempt.invocations);
  });

  test('suppresses oversized fields while preserving available detail fields', () => {
    const result = presentStepAttemptDiagnostics(
      compactAttempt(),
      attemptDetail({
        output: {source: 'detail'},
        outputs: {mapped: 'detail'},
        response: 'detail response',
        error: {message: 'detail error'},
        gateResult: {kind: 'passed', passed: true, source: 'exit 0', exitCode: 0},
        restartFeedback: 'detail feedback',
        oversizedFields: [
          unavailableField('output'),
          unavailableField('gate_result'),
          unavailableField('restart_feedback'),
        ],
      }),
    );

    expect(result.output).toBeNull();
    expect(result.gateResult).toBeNull();
    expect(result.restartFeedback).toBeNull();
    expect(result.outputs).toEqual({mapped: 'detail'});
    expect(result.response).toBe('detail response');
    expect(result.error).toEqual({message: 'detail error'});
  });
});

describe('isTerminalStepAttemptStatus', () => {
  test.each(['succeeded', 'failed', 'cancelled'])('%s is terminal', (status) => {
    expect(isTerminalStepAttemptStatus(status)).toBe(true);
  });

  test.each(['pending', 'running', 'skipped'])('%s is not terminal', (status) => {
    expect(isTerminalStepAttemptStatus(status)).toBe(false);
  });
});

function compactAttempt(): StepAttempt {
  return new StepAttempt({
    id: 'attempt-1',
    stepId: 'step-1',
    jobExecutionId: 'execution-1',
    attempt: 1,
    executionOrder: 1,
    status: 'running',
    exitCode: null,
    output: {source: 'compact'},
    outputs: {mapped: 'compact'},
    response: 'compact response',
    error: {message: 'compact error'},
    gateResult: {kind: 'passed', passed: true, source: 'compact', exitCode: 0},
    restartFeedback: 'compact feedback',
    invocations: [
      {
        callIndex: 0,
        startedAt: '2026-09-01T09:00:00.000Z',
      },
    ],
    startedAt: '2026-09-01T09:00:00.000Z',
    finishedAt: null,
  });
}

function attemptDetail(overrides: Partial<StepAttemptDetail> = {}): StepAttemptDetail {
  return {
    stepId: 'step-1',
    attempt: 1,
    session: null,
    authoredConfig: null,
    config: null,
    toolArguments: null,
    evaluationTrace: null,
    ...overrides,
  };
}

function unavailableField(field: 'output' | 'gate_result' | 'restart_feedback') {
  return {
    field,
    storedBytes: 70_000,
    reason: 'legacy_value_exceeds_inline_limit' as const,
  };
}
