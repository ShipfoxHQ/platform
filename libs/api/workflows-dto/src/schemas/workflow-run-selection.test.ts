import {
  workflowRunSelectionQuerySchema,
  workflowRunSelectionResponseSchema,
} from './workflow-run-selection.js';

const ids = {
  run: '11111111-1111-4111-8111-111111111111',
  job: '22222222-2222-4222-8222-222222222222',
  execution: '33333333-3333-4333-8333-333333333333',
  step: '44444444-4444-4444-8444-444444444444',
  stepAttempt: '55555555-5555-4555-8555-555555555555',
};

describe('workflow run selection schemas', () => {
  test.each([
    ['job_id', ids.job],
    ['job_execution_id', ids.execution],
    ['step_id', ids.step],
    ['step_attempt_id', ids.stepAttempt],
  ])('accepts a %s-only selection query', (key, value) => {
    const result = workflowRunSelectionQuerySchema.parse({[key]: value});

    expect(result).toEqual({[key]: value});
  });

  test('coerces and accepts an optional attempt', () => {
    expect(workflowRunSelectionQuerySchema.parse({step_id: ids.step, attempt: '2'})).toEqual({
      step_id: ids.step,
      attempt: 2,
    });
  });

  test.each([
    {},
    {attempt: '2'},
    {job_id: 'not-a-uuid'},
  ])('rejects an incomplete or invalid query: %j', (query) => {
    expect(workflowRunSelectionQuerySchema.safeParse(query).success).toBe(false);
  });

  test('parses ancestry and the selected step source location', () => {
    const result = workflowRunSelectionResponseSchema.parse({
      workflow_run_id: ids.run,
      workflow_run_attempt: 2,
      job_id: ids.job,
      job_execution_id: ids.execution,
      step_id: ids.step,
      step_attempt_id: ids.stepAttempt,
      step_attempt: 1,
      source_location: {start_line: 5, end_line: 8},
    });

    expect(result.source_location).toEqual({start_line: 5, end_line: 8});
  });
});
