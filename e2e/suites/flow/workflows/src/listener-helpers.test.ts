import type {
  JobDto,
  WorkflowExecutionEventDto,
  WorkflowRunDetailResponseDto,
  WorkflowRunJobDetailDto,
  WorkflowRunJobExecutionDetailDto,
} from '@shipfox/api-workflows-dto';
import {
  batchedListenerExecutionMatches,
  findListenerExecutionByDeliveryId,
  findListenerExecutionByDeliveryIds,
  listenerDeliveryObserved,
  listenerExecutionCountMatches,
  listenerResolutionMatches,
} from './listener-helpers.js';

const timestamp = '2026-07-04T08:00:00.000Z';

function event(overrides: Partial<WorkflowExecutionEventDto> = {}): WorkflowExecutionEventDto {
  return {
    source: 'fire-source',
    event: 'received',
    delivery_id: 'delivery-1',
    received_at: timestamp,
    project: null,
    repository: null,
    ref: null,
    commit: null,
    data: {body: {message: 'hello'}},
    ...overrides,
  };
}

function execution(
  overrides: Partial<WorkflowRunJobExecutionDetailDto> = {},
): WorkflowRunJobExecutionDetailDto {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    job_id: '77777777-7777-4777-8777-777777777777',
    sequence: 1,
    name: 'listen #1',
    status: 'succeeded',
    status_reason: null,
    runner: null,
    trigger_events: [event()],
    outputs: null,
    evaluation_trace: null,
    queued_at: timestamp,
    started_at: timestamp,
    finished_at: timestamp,
    timed_out_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    steps: [],
    ...overrides,
  };
}

function listenerJob(overrides: Partial<WorkflowRunJobDetailDto> = {}): WorkflowRunJobDetailDto {
  const base: JobDto = {
    id: '77777777-7777-4777-8777-777777777777',
    run_attempt_id: '88888888-8888-4888-8888-888888888888',
    key: 'listen',
    name: null,
    mode: 'listening',
    status: 'succeeded',
    status_reason: null,
    success: null,
    runner: null,
    evaluation_trace: null,
    carried_over: false,
    listening: {
      on: [{source: 'fire-source', event: 'received'}],
      until: [{source: 'resolve-source', event: 'received'}],
      timeout_ms: null,
      max_executions: null,
      batch: null,
      on_resolve: 'finish',
      execution_timeout_ms: null,
      name: null,
    },
    listener_status: 'resolved',
    resolution_reason: 'until',
    outputs: null,
    dependencies: [],
    position: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };
  return {...base, job_executions: [execution()], ...overrides};
}

function runDetail(
  overrides: Partial<WorkflowRunDetailResponseDto> = {},
): WorkflowRunDetailResponseDto {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    project_id: '11111111-1111-4111-8111-111111111111',
    definition_id: '22222222-2222-4222-8222-222222222222',
    number: 1,
    name: 'Listener workflow',
    workflow_name: 'Listener workflow',
    status: 'succeeded',
    current_attempt: 1,
    latest_attempt: 1,
    trigger_provider: 'manual',
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_payload: {},
    trigger_reference: null,
    inputs: null,
    source_snapshot: null,
    created_at: timestamp,
    updated_at: timestamp,
    started_at: timestamp,
    finished_at: timestamp,
    run_attempt: {
      id: '88888888-8888-4888-8888-888888888888',
      workflow_run_id: '33333333-3333-4333-8333-333333333333',
      attempt: 1,
      status: 'succeeded',
      created_at: timestamp,
      started_at: timestamp,
      finished_at: timestamp,
      rerun_mode: null,
    },
    jobs: [listenerJob()],
    has_started_job_execution: true,
    ...overrides,
  };
}

describe('listener helper predicates', () => {
  test('finds the listener execution containing a delivery id', () => {
    const detail = runDetail({
      jobs: [
        listenerJob({
          job_executions: [
            execution({sequence: 1, trigger_events: [event({delivery_id: 'delivery-1'})]}),
            execution({sequence: 2, trigger_events: [event({delivery_id: 'delivery-2'})]}),
          ],
        }),
      ],
    });

    const result = findListenerExecutionByDeliveryId({
      runDetail: detail,
      jobKey: 'listen',
      deliveryId: 'delivery-2',
    });

    expect(result?.sequence).toBe(2);
  });

  test('finds the listener execution containing any delivery id', () => {
    const detail = runDetail({
      jobs: [
        listenerJob({
          job_executions: [
            execution({sequence: 1, trigger_events: [event({delivery_id: 'delivery-1'})]}),
            execution({sequence: 2, trigger_events: [event({delivery_id: 'delivery-2'})]}),
          ],
        }),
      ],
    });

    const result = findListenerExecutionByDeliveryIds({
      runDetail: detail,
      jobKey: 'listen',
      deliveryIds: ['delivery-3', 'delivery-2'],
    });

    expect(result?.deliveryId).toBe('delivery-2');
    expect(result?.execution.sequence).toBe(2);
  });

  test('reports a missing delivery with observed delivery ids', () => {
    const result = listenerDeliveryObserved({
      runDetail: runDetail(),
      jobKey: 'listen',
      deliveryId: 'missing-delivery',
    });

    expect(result).toEqual({
      matched: false,
      diagnostic:
        'listener job listen did not observe delivery missing-delivery; observed=[delivery-1]',
    });
  });

  test('matches listener execution counts', () => {
    const detail = runDetail({
      jobs: [
        listenerJob({
          job_executions: [
            execution({sequence: 1}),
            execution({id: '99999999-9999-4999-8999-999999999999', sequence: 2}),
          ],
        }),
      ],
    });

    const result = listenerExecutionCountMatches({runDetail: detail, jobKey: 'listen', count: 2});

    expect(result.matched).toBe(true);
  });

  test('matches listener resolution status and reason', () => {
    const result = listenerResolutionMatches({
      runDetail: runDetail(),
      jobKey: 'listen',
      status: 'succeeded',
      reason: 'until',
    });

    expect(result.matched).toBe(true);
  });

  test('reports listener resolution mismatches', () => {
    const result = listenerResolutionMatches({
      runDetail: runDetail({
        jobs: [
          listenerJob({status: 'running', listener_status: 'listening', resolution_reason: null}),
        ],
      }),
      jobKey: 'listen',
      status: 'succeeded',
      reason: 'until',
    });

    expect(result).toEqual({
      matched: false,
      diagnostic:
        'listener job listen status=running, listenerStatus=listening, resolutionReason=null, expected=succeeded/resolved/until',
    });
  });

  test('matches a batched execution containing every expected delivery', () => {
    const result = batchedListenerExecutionMatches({
      runDetail: runDetail({
        jobs: [
          listenerJob({
            job_executions: [
              execution({
                trigger_events: [
                  event({delivery_id: 'delivery-1'}),
                  event({delivery_id: 'delivery-2'}),
                ],
              }),
            ],
          }),
        ],
      }),
      jobKey: 'listen',
      sequence: 1,
      deliveryIds: ['delivery-1', 'delivery-2'],
    });

    expect(result.matched).toBe(true);
  });
});
