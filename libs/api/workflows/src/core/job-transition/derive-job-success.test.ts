import type {Job} from '../entities/job.js';
import type {JobExecution} from '../entities/job-execution.js';
import {deriveJobSuccess} from './derive-job-success.js';

describe('deriveJobSuccess', () => {
  test('treats zero or cancelled listener executions as successful by default', () => {
    const empty = deriveJobSuccess({success: null, executions: [], jobs: []});
    const cancelled = deriveJobSuccess({
      success: null,
      executions: [jobExecution({status: 'cancelled'})],
      jobs: [],
    });

    expect(empty).toMatchObject({status: 'succeeded', statusReason: null});
    expect(cancelled).toMatchObject({status: 'succeeded', statusReason: null});
    expect(empty.trace).toEqual([
      expect.objectContaining({
        expression: "!executions.exists(e, e.status == 'failed')",
        roots: ['executions'],
        fillTarget: 'job-resolution',
        evaluatedAt: 'job-resolution',
        value: 'true',
        field: 'job.success',
      }),
    ]);
    expect(cancelled.trace).toEqual(empty.trace);
  });

  test('fails with the first execution status reason when the success expression is false', () => {
    const result = deriveJobSuccess({
      success: null,
      executions: [jobExecution({status: 'failed', statusReason: 'timed_out'})],
      jobs: [],
    });

    expect(result).toMatchObject({status: 'failed', statusReason: 'timed_out'});
  });

  test('resolves custom success expressions over direct dependency outputs', () => {
    const build = workflowJob({
      key: 'build',
      status: 'succeeded',
      outputs: {release: 'yes'},
    });

    const result = deriveJobSuccess({
      success: 'jobs.build.status == "succeeded" && jobs.build.outputs.release == "yes"',
      executions: [jobExecution({status: 'succeeded'})],
      jobs: [{job: build, executions: []}],
    });

    expect(result).toMatchObject({status: 'succeeded', statusReason: null});
  });

  test('resolves vars from the run-creation snapshot', () => {
    const result = deriveJobSuccess({
      success: 'vars.RELEASE == "yes"',
      executions: [jobExecution({status: 'succeeded'})],
      jobs: [],
      vars: {RELEASE: 'yes'},
    });

    expect(result).toMatchObject({status: 'succeeded', statusReason: null});
  });

  test('fails closed when the success expression throws at runtime', () => {
    const result = deriveJobSuccess({
      success: 'executions.all(e, 1 / 0 == 0)',
      executions: [jobExecution({status: 'succeeded'})],
      jobs: [],
    });

    expect(result).toMatchObject({
      status: 'failed',
      statusReason: 'unknown',
      trace: [
        expect.objectContaining({
          expression: 'executions.all(e, 1 / 0 == 0)',
          roots: ['executions'],
          fillTarget: 'job-resolution',
          evaluatedAt: 'job-resolution',
          value: 'false',
          degraded: true,
          field: 'job.success',
        }),
      ],
    });
  });
});

function workflowJob(params: Partial<Job> & Pick<Job, 'key'>): Job {
  return {
    id: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    key: params.key,
    mode: 'one_shot',
    name: null,
    status: params.status ?? 'pending',
    statusReason: null,
    carriedOver: false,
    checkout: {permissions: {contents: 'read'}, persistCredentials: true},
    success: null,
    evaluationTrace: null,
    executionTimeoutMs: null,
    listeningTimeoutMs: null,
    maxExecutions: null,
    onResolve: null,
    batchDebounceMs: null,
    batchMaxSize: null,
    batchMaxWaitMs: null,
    listenerStatus: 'inactive',
    resolutionReason: null,
    listeningOn: null,
    listeningUntil: null,
    outputs: params.outputs ?? null,
    dependencies: params.dependencies ?? [],
    runner: ['ubuntu-latest'],
    position: params.position ?? 0,
    version: params.version ?? 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function jobExecution(params: Partial<JobExecution> = {}): JobExecution {
  return {
    id: crypto.randomUUID(),
    jobId: params.jobId ?? crypto.randomUUID(),
    sequence: params.sequence ?? 1,
    nameOverride: params.nameOverride ?? params.name ?? 'build',
    name: params.name ?? 'build',
    runner: null,
    status: params.status ?? 'succeeded',
    statusReason: params.statusReason ?? null,
    outputs: params.outputs ?? null,
    triggerEvents: [],
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    timedOutAt: null,
  };
}
