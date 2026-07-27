import {runAnnotationDto} from '#test/fixtures/annotations.js';
import {toRunAnnotation} from './run-annotation-mapper.js';

describe('run annotation mapper', () => {
  it('maps an annotation DTO to the client model', () => {
    const annotation = toRunAnnotation(
      runAnnotationDto({
        id: '11111111-1111-4111-8111-111111111111',
        job_id: '22222222-2222-4222-8222-222222222222',
        job_execution_id: '33333333-3333-4333-8333-333333333333',
        origin_step_id: '44444444-4444-4444-8444-444444444444',
        origin_step_attempt: 2,
        context: 'summary',
        style: 'warning',
        sequence: 7,
        body: 'body',
      }),
    );

    expect(annotation).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      jobId: '22222222-2222-4222-8222-222222222222',
      jobExecutionId: '33333333-3333-4333-8333-333333333333',
      originStepId: '44444444-4444-4444-8444-444444444444',
      originStepAttempt: 2,
      context: 'summary',
      style: 'warning',
      sequence: 7,
      body: 'body',
    });
  });
});
