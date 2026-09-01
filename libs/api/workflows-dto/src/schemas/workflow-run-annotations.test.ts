import {
  workflowRunAnnotationItemSchema,
  workflowRunAnnotationsQuerySchema,
  workflowRunAnnotationsResponseSchema,
  workflowRunJobExplanationsResponseSchema,
} from './workflow-run-annotations.js';

const ids = {
  annotation: '11111111-1111-4111-8111-111111111111',
  job: '22222222-2222-4222-8222-222222222222',
  execution: '33333333-3333-4333-8333-333333333333',
  step: '44444444-4444-4444-8444-444444444444',
  stepAttempt: '55555555-5555-4555-8555-555555555555',
};

const annotation = {
  id: ids.annotation,
  job_id: ids.job,
  job_execution_id: ids.execution,
  origin_step_id: ids.step,
  origin_step_attempt: 1,
  context: 'deployment-url',
  style: 'info' as const,
  sequence: 1,
  body: 'https://example.com/deployments/1',
};

describe('workflow run annotation and job explanation schemas', () => {
  test('coerces bounded page query values and defaults the limit', () => {
    expect(workflowRunAnnotationsQuerySchema.parse({attempt: '2'})).toEqual({
      attempt: 2,
      limit: 100,
    });
  });

  test('accepts canonical annotation ancestry with a missing dispatched attempt link', () => {
    const item = workflowRunAnnotationItemSchema.parse({
      annotation,
      origin: {
        job_id: ids.job,
        job_label: 'Build',
        job_position: 0,
        job_execution_id: ids.execution,
        execution_sequence: 1,
        execution_label: null,
        step_id: ids.step,
        step_label: 'Publish URL',
        step_attempt_id: null,
        step_attempt: 1,
      },
    });

    expect(item.annotation.body).toBe(annotation.body);
    expect(item.origin.step_attempt_id).toBeNull();
  });

  test('keeps annotation pages and no-execution explanations bounded and cursor-paginated', () => {
    const annotations = workflowRunAnnotationsResponseSchema.parse({
      items: [
        {
          annotation,
          origin: {
            job_id: ids.job,
            job_label: 'Build',
            job_position: 0,
            job_execution_id: ids.execution,
            execution_sequence: 1,
            execution_label: 'Build',
            step_id: ids.step,
            step_label: 'Publish URL',
            step_attempt_id: ids.stepAttempt,
            step_attempt: 1,
          },
        },
      ],
      next_cursor: 'next',
    });
    const explanations = workflowRunJobExplanationsResponseSchema.parse({
      items: [
        {
          job_id: ids.job,
          job_label: 'Build',
          job_position: 0,
          status: 'skipped',
          status_reason: 'condition_rejected',
          evaluation_trace: null,
        },
      ],
      next_cursor: null,
    });

    expect(annotations.items).toHaveLength(1);
    expect(explanations.items[0]?.status).toBe('skipped');
  });
});
