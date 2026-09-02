import {stepAttemptDetailResponseSchema} from './workflow-run-detail.js';

describe('stepAttemptDetailResponseSchema', () => {
  test('accepts the pre-diagnostic response during a rolling deployment', () => {
    const result = stepAttemptDetailResponseSchema.safeParse({
      workflow_run_id: '11111111-1111-4111-8111-111111111111',
      workflow_run_attempt: 1,
      job_id: '22222222-2222-4222-8222-222222222222',
      job_execution_id: '33333333-3333-4333-8333-333333333333',
      step_id: '44444444-4444-4444-8444-444444444444',
      step_attempt_id: '55555555-5555-4555-8555-555555555555',
      attempt: 1,
      authored_config: null,
      config: null,
      session: null,
      evaluation_trace: null,
    });

    expect(result.success).toBe(true);
  });
});
