import {workflowJob, workflowJobExecutionDto} from '#test/fixtures/workflow-run.js';
import {
  groupRunAnnotationsByExecution,
  RUN_ANNOTATIONS_POLL_MS,
  type RunAnnotation,
  runAnnotationsRefetchInterval,
  selectJobExecutionAnnotations,
  selectStepAnnotations,
  toRunAnnotation,
} from './run-annotation.js';

describe('run annotations', () => {
  it('maps annotation DTOs to the client model', () => {
    const annotation = toRunAnnotation({
      id: '11111111-1111-4111-8111-111111111111',
      job_id: '22222222-2222-4222-8222-222222222222',
      job_execution_id: '33333333-3333-4333-8333-333333333333',
      origin_step_id: '44444444-4444-4444-8444-444444444444',
      origin_step_attempt: 2,
      context: 'summary',
      style: 'warning',
      sequence: 7,
      body: 'body',
    });

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

  it('selects step annotations by step id and attempt in sequence order', () => {
    const annotations = [
      runAnnotation({id: 'b', originStepId: 'step-1', originStepAttempt: 1, sequence: 2}),
      runAnnotation({id: 'c', originStepId: 'step-2', originStepAttempt: 1, sequence: 1}),
      runAnnotation({id: 'a', originStepId: 'step-1', originStepAttempt: 1, sequence: 1}),
      runAnnotation({id: 'd', originStepId: 'step-1', originStepAttempt: 2, sequence: 3}),
    ];

    const selected = selectStepAnnotations(annotations, {stepId: 'step-1', attempt: 1});

    expect(selected.map((annotation) => annotation.id)).toEqual(['a', 'b']);
  });

  it('returns no step annotations without a step id or attempt', () => {
    const annotations = [runAnnotation({originStepId: 'step-1', originStepAttempt: 1})];

    expect(selectStepAnnotations(annotations, {stepId: undefined, attempt: 1})).toEqual([]);
    expect(selectStepAnnotations(annotations, {stepId: 'step-1', attempt: undefined})).toEqual([]);
  });

  it('selects job execution annotations in sequence order', () => {
    const annotations = [
      runAnnotation({id: 'b', jobExecutionId: 'execution-1', sequence: 2}),
      runAnnotation({id: 'a', jobExecutionId: 'execution-1', sequence: 1}),
      runAnnotation({id: 'c', jobExecutionId: 'execution-2', sequence: 1}),
    ];

    const selected = selectJobExecutionAnnotations(annotations, {jobExecutionId: 'execution-1'});

    expect(selected.map((annotation) => annotation.id)).toEqual(['a', 'b']);
  });

  it('returns no job annotations without an execution id', () => {
    expect(
      selectJobExecutionAnnotations([runAnnotation({jobExecutionId: 'execution-1'})], {
        jobExecutionId: undefined,
      }),
    ).toEqual([]);
  });

  it('groups run annotations by job execution in run graph order', () => {
    const buildFirst = workflowJobExecutionDto({id: 'build-1', job_id: 'build-job', sequence: 1});
    const buildSecond = workflowJobExecutionDto({id: 'build-2', job_id: 'build-job', sequence: 2});
    const deployFirst = workflowJobExecutionDto({
      id: 'deploy-1',
      job_id: 'deploy-job',
      sequence: 1,
    });
    const jobs = [
      workflowJob({
        id: 'build-job',
        name: 'build',
        job_executions: [buildFirst, buildSecond],
      }),
      workflowJob({id: 'deploy-job', name: 'deploy', job_executions: [deployFirst]}),
    ];
    const annotations = [
      runAnnotation({id: 'deploy', jobExecutionId: 'deploy-1', sequence: 1}),
      runAnnotation({id: 'build-2b', jobExecutionId: 'build-2', sequence: 2}),
      runAnnotation({id: 'build-2a', jobExecutionId: 'build-2', sequence: 1}),
      runAnnotation({id: 'unknown', jobExecutionId: 'unknown-execution', sequence: 1}),
    ];

    const groups = groupRunAnnotationsByExecution(annotations, jobs);

    expect(
      groups.map((group) => ({
        job: group.job.displayName,
        execution: group.jobExecution.id,
        annotations: group.annotations.map((annotation) => annotation.id),
      })),
    ).toEqual([
      {job: 'build', execution: 'build-2', annotations: ['build-2a', 'build-2b']},
      {job: 'deploy', execution: 'deploy-1', annotations: ['deploy']},
    ]);
  });

  it('returns no run annotation groups when annotations or jobs are empty', () => {
    expect(groupRunAnnotationsByExecution([], [workflowJob()])).toEqual([]);
    expect(groupRunAnnotationsByExecution([runAnnotation()], [])).toEqual([]);
  });

  it('computes the annotations polling cadence', () => {
    expect(runAnnotationsRefetchInterval({runStatus: undefined, graceLeft: 0})).toBe(
      RUN_ANNOTATIONS_POLL_MS,
    );
    expect(runAnnotationsRefetchInterval({runStatus: 'running', graceLeft: 0})).toBe(
      RUN_ANNOTATIONS_POLL_MS,
    );
    expect(runAnnotationsRefetchInterval({runStatus: 'succeeded', graceLeft: 1})).toBe(
      RUN_ANNOTATIONS_POLL_MS,
    );
    expect(runAnnotationsRefetchInterval({runStatus: 'failed', graceLeft: 0})).toBe(false);
  });
});

function runAnnotation(overrides: Partial<RunAnnotation> = {}): RunAnnotation {
  return {
    id: 'annotation-1',
    jobId: 'job-1',
    jobExecutionId: 'execution-1',
    originStepId: 'step-1',
    originStepAttempt: 1,
    context: 'summary',
    style: 'default',
    sequence: 1,
    body: 'body',
    ...overrides,
  };
}
