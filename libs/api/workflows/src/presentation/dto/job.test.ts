import type {Job} from '#core/entities/job.js';
import type {JobExecution} from '#core/entities/job-execution.js';
import {toJobDto, toJobExecutionDto} from './job.js';

describe('toJobDto', () => {
  it('maps job status reason to snake_case', () => {
    const job = jobEntity({
      status: 'skipped',
      statusReason: 'dependency_not_completed',
      outputs: {image_sha: 'abc123'},
    });

    const dto = toJobDto(job);

    expect(dto.status).toBe('skipped');
    expect(dto.status_reason).toBe('dependency_not_completed');
    expect(dto.outputs).toEqual({image_sha: 'abc123'});
  });
});

describe('toJobExecutionDto', () => {
  it('maps listener trigger events', () => {
    const jobExecution = jobExecutionEntity({
      outputs: {verdict: 'approved'},
      triggerEvents: [
        {
          source: 'github',
          event: 'deployment_status',
          delivery_id: 'delivery-1',
          received_at: '2026-06-25T00:00:00.000Z',
          project: null,
          repository: null,
          ref: null,
          commit: null,
          data: {state: 'success'},
        },
      ],
    });

    const dto = toJobExecutionDto(jobExecution);

    expect(dto.outputs).toEqual({verdict: 'approved'});
    expect(dto.trigger_events).toEqual([
      {
        source: 'github',
        event: 'deployment_status',
        delivery_id: 'delivery-1',
        received_at: '2026-06-25T00:00:00.000Z',
        project: null,
        repository: null,
        ref: null,
        commit: null,
        data: {state: 'success'},
      },
    ]);
  });
});

function jobEntity(overrides: Partial<Job> = {}): Job {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workflowRunAttemptId: '22222222-2222-4222-8222-222222222222',
    key: 'deploy',
    name: null,
    mode: 'one_shot',
    status: 'pending',
    statusReason: null,
    outputs: null,
    carriedOver: false,
    checkout: {
      permissions: {contents: 'read'},
      persistCredentials: true,
    },
    success: null,
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
    dependencies: [],
    runner: null,
    position: 0,
    version: 1,
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:01.000Z'),
    ...overrides,
  };
}

function jobExecutionEntity(overrides: Partial<JobExecution> = {}): JobExecution {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    jobId: '11111111-1111-4111-8111-111111111111',
    sequence: 1,
    nameOverride: 'deploy',
    name: 'deploy',
    runner: null,
    status: 'pending',
    statusReason: null,
    outputs: null,
    triggerEvents: [],
    version: 1,
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:01.000Z'),
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    timedOutAt: null,
    ...overrides,
  };
}
