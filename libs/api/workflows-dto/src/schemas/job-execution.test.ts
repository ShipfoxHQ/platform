import {
  nextStepResponseSchema,
  reportStepBodySchema,
  STEP_RESPONSE_MAX_LENGTH,
} from './job-execution.js';

describe('nextStepResponseSchema', () => {
  it('accepts a server-executed tool wait response', () => {
    expect(nextStepResponseSchema.parse({kind: 'wait', retry_after_ms: 1000})).toEqual({
      kind: 'wait',
      retry_after_ms: 1000,
    });
  });

  it('rejects a non-positive wait interval', () => {
    expect(nextStepResponseSchema.safeParse({kind: 'wait', retry_after_ms: 0}).success).toBe(false);
  });
});

describe('reportStepBodySchema', () => {
  it('accepts a capped agent response', () => {
    const parsed = reportStepBodySchema.parse({
      status: 'succeeded',
      attempt: 1,
      exit_code: 0,
      log_outcome: 'drained',
      response: 'done',
    });

    expect(parsed.response).toBe('done');
  });

  it('rejects responses over the cap', () => {
    const result = reportStepBodySchema.safeParse({
      status: 'succeeded',
      attempt: 1,
      exit_code: 0,
      log_outcome: 'drained',
      response: 'x'.repeat(STEP_RESPONSE_MAX_LENGTH + 1),
    });

    expect(result.success).toBe(false);
  });
  it('accepts resolved checkout details as a dedicated report field', () => {
    const parsed = reportStepBodySchema.parse({
      status: 'succeeded',
      attempt: 1,
      exit_code: 0,
      log_outcome: 'drained',
      checkout: {
        repository: 'https://github.com/acme/api.git',
        ref: 'refs/pull/412/head',
        commit: '9f2c000000000000000000000000000000000000',
        path: '/runner/workspace/job-1',
      },
    });
    expect(parsed.checkout?.ref).toBe('refs/pull/412/head');
  });
});
