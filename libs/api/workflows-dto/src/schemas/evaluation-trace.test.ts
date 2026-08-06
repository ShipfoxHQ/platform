import {evaluationTraceSchema} from './evaluation-trace.js';

describe('evaluation trace schema', () => {
  it('accepts value entries with resolved and diagnostic metadata', () => {
    const trace = evaluationTraceSchema.parse([
      {
        expression: 'inputs.environment',
        roots: ['inputs.environment'],
        fill_target: 'agent.prompt',
        evaluated_at: '2026-08-05T12:00:00.000Z',
        field: 'agent.prompt',
        value: 'production',
        reference: true,
        degraded: false,
        env_key: 'ENVIRONMENT',
      },
    ]);

    expect(trace[0]).toMatchObject({
      field: 'agent.prompt',
      value: 'production',
      reference: true,
      env_key: 'ENVIRONMENT',
    });
  });

  it('accepts an explicit trace budget marker', () => {
    expect(evaluationTraceSchema.parse([{truncated: true, dropped: 3}])).toEqual([
      {truncated: true, dropped: 3},
    ]);
  });

  it('rejects malformed trace entries', () => {
    const result = evaluationTraceSchema.safeParse([
      {expression: 'inputs.environment', field: 'agent.prompt'},
    ]);

    expect(result.success).toBe(false);
  });
});
