import type {
  WorkflowRunAnnotationItemDto,
  WorkflowRunJobExplanationDto,
} from '@shipfox/api-workflows-dto';
import {toRunAnnotationEntry, toRunJobExplanation} from './run-annotation-mapper.js';

const JOB_ID = '44444444-4444-4444-8444-00000000000b';
const EXECUTION_ID = '77777777-7777-4777-8777-00000000000b';
const STEP_ID = '55555555-5555-4555-8555-00000000000b';

describe('run annotation mappers', () => {
  test('maps server-owned annotation provenance without reconstructing a run tree', () => {
    const entry = toRunAnnotationEntry(annotationItem({step_attempt_id: null}));

    expect(entry).toMatchObject({
      jobName: 'Build web',
      jobPosition: 3,
      executionSequence: 2,
      executionLabel: 'execution #2',
      stepLabel: 'Publish URL',
      attemptLabel: 'attempt 4',
      origin: null,
    });
  });

  test('maps a routable step attempt and a no-execution job explanation', () => {
    const stepAttemptId = '66666666-6666-4666-8666-00000000000b';
    const entry = toRunAnnotationEntry(annotationItem({step_attempt_id: stepAttemptId}));
    const explanation = toRunJobExplanation(jobExplanation());

    expect(entry.origin).toEqual({
      jobId: JOB_ID,
      jobExecutionId: EXECUTION_ID,
      stepId: STEP_ID,
      stepAttemptId,
    });
    expect(explanation).toMatchObject({
      jobId: JOB_ID,
      jobName: 'Build web',
      jobPosition: 3,
      status: 'skipped',
      statusReason: 'condition_rejected',
      evaluationTrace: [
        {
          expression: `\${{ inputs.publish }}`,
          fillTarget: 'jobs.build.if',
          field: 'if',
          value: 'false',
        },
      ],
    });
  });
});

function annotationItem(
  originOverrides: Partial<WorkflowRunAnnotationItemDto['origin']> = {},
): WorkflowRunAnnotationItemDto {
  return {
    annotation: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
      job_id: JOB_ID,
      job_execution_id: EXECUTION_ID,
      origin_step_id: STEP_ID,
      origin_step_attempt: 4,
      context: 'release URL',
      style: 'info',
      sequence: 9,
      body: 'Published https://example.test',
    },
    origin: {
      job_id: JOB_ID,
      job_label: 'Build web',
      job_position: 3,
      job_execution_id: EXECUTION_ID,
      execution_sequence: 2,
      execution_label: 'execution #2',
      step_id: STEP_ID,
      step_label: 'Publish URL',
      step_attempt_id: null,
      step_attempt: 4,
      ...originOverrides,
    },
  };
}

function jobExplanation(): WorkflowRunJobExplanationDto {
  return {
    job_id: JOB_ID,
    job_label: 'Build web',
    job_position: 3,
    status: 'skipped',
    status_reason: 'condition_rejected',
    evaluation_trace: [
      {
        expression: `\${{ inputs.publish }}`,
        roots: ['inputs'],
        fill_target: 'jobs.build.if',
        evaluated_at: '2026-09-04T12:00:00.000Z',
        field: 'if',
        value: 'false',
      },
    ],
  };
}
