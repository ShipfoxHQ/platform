import type {EvaluationTraceValueEntry} from '#core/entities/step-attempt.js';
import type {RunJobExplanation} from '#core/run-annotation.js';
import {presentRunJobExplanation} from './run-job-explanation.js';

describe('presentRunJobExplanation', () => {
  test.each([
    ['dependency_not_completed', 'A required job did not complete, so this job did not run.'],
    ['default_gate_rejected', 'A required job did not succeed, so this job did not run.'],
    ['condition_false', 'Its condition evaluated to false, so this job did not run.'],
    ['condition_rejected', 'Its condition evaluated to false, so this job did not run.'],
  ] as const)('presents the expected %s skip neutrally', (statusReason, body) => {
    const presentation = presentRunJobExplanation(explanation({statusReason}));

    expect(presentation).toEqual({style: 'default', statusLabel: 'Skipped', body});
  });

  test('makes a condition evaluation error actionable', () => {
    const presentation = presentRunJobExplanation(
      explanation({
        statusReason: 'condition_errored',
        evaluationTrace: [evaluationTrace({degraded: true})],
      }),
    );

    expect(presentation).toMatchObject({
      style: 'warning',
      statusLabel: 'Skipped',
      body: expect.stringContaining(
        "Shipfox could not evaluate this job's condition. Review the condition and the values it references.",
      ),
    });
    expect(presentation.body).toContain('Condition evaluation:');
    expect(presentation.body).toContain('`job.if` evaluated `needs.build.result == "succeeded"`');
  });

  test.each([
    ['user_cancelled', 'This job did not run because it was cancelled.'],
    ['run_cancelled', 'This job did not run because the run was cancelled.'],
  ] as const)('presents the expected %s cancellation neutrally', (statusReason, body) => {
    const presentation = presentRunJobExplanation(explanation({statusReason}));

    expect(presentation).toEqual({style: 'default', statusLabel: 'Skipped', body});
  });

  test('calls attention to a skipped job with no recorded reason', () => {
    const presentation = presentRunJobExplanation(explanation({statusReason: 'unknown'}));

    expect(presentation).toEqual({
      style: 'warning',
      statusLabel: 'Skipped',
      body: 'This job did not run. Shipfox did not record a reason.',
    });
  });

  test('explains a rejected job success condition', () => {
    const presentation = presentRunJobExplanation(
      explanation({
        status: 'failed',
        statusReason: 'step_failed',
        evaluationTrace: [evaluationTrace({field: 'job.success', value: 'false'})],
      }),
    );

    expect(presentation).toMatchObject({
      style: 'error',
      statusLabel: 'Failed',
      body: expect.stringContaining('Its success condition evaluated to false.'),
    });
  });

  test('makes a degraded job success condition actionable', () => {
    const presentation = presentRunJobExplanation(
      explanation({
        status: 'failed',
        statusReason: 'unknown',
        evaluationTrace: [evaluationTrace({field: 'job.success', value: '', degraded: true})],
      }),
    );

    expect(presentation.body).toContain(
      "Shipfox could not evaluate this job's success condition. Review the condition and the values it references.",
    );
  });

  test('does not invent recovery advice when a failed job has no reason', () => {
    const presentation = presentRunJobExplanation(
      explanation({status: 'failed', statusReason: 'unknown'}),
    );

    expect(presentation).toEqual({
      style: 'error',
      statusLabel: 'Failed',
      body: 'This job failed without running any work. Shipfox did not record a reason.',
    });
  });
});

function explanation(overrides: Partial<RunJobExplanation> = {}): RunJobExplanation {
  return {
    jobId: '44444444-4444-4444-8444-00000000000d',
    jobName: 'deploy',
    jobPosition: 1,
    status: 'skipped',
    statusReason: 'condition_rejected',
    evaluationTrace: null,
    ...overrides,
  };
}

function evaluationTrace(
  overrides: Partial<EvaluationTraceValueEntry> = {},
): EvaluationTraceValueEntry {
  return {
    expression: 'needs.build.result == "succeeded"',
    roots: ['needs'],
    fillTarget: 'job.if',
    evaluatedAt: '2026-09-04T10:00:00.000Z',
    field: 'job.if',
    value: 'false',
    ...overrides,
  };
}
