import type {WorkflowExecutionEventDto} from '@shipfox/api-workflows-dto';
import type {
  WorkflowExecutionObservation,
  WorkflowJobObservation,
  WorkflowRunObservation,
} from '@shipfox/e2e-observe-workflows';
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
  overrides: Partial<WorkflowExecutionObservation> = {},
): WorkflowExecutionObservation {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    job_id: '77777777-7777-4777-8777-777777777777',
    sequence: 1,
    name: 'listen #1',
    status: 'succeeded',
    display_status: 'succeeded',
    status_reason: null,
    status_reason_message: null,
    runner: null,
    trigger_events: [event()],
    outputs: null,
    queued_at: timestamp,
    started_at: timestamp,
    finished_at: timestamp,
    timed_out_at: null,
    updated_at: timestamp,
    steps: [],
    context: null,
    ...overrides,
  };
}

function listenerJob(overrides: Partial<WorkflowJobObservation> = {}): WorkflowJobObservation {
  const executions = overrides.executions ?? [execution()];
  const executionStatusCounts = {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const candidate of executions) executionStatusCounts[candidate.status] += 1;
  const base: WorkflowJobObservation = {
    id: '77777777-7777-4777-8777-777777777777',
    key: 'listen',
    name: null,
    mode: 'listening',
    status: 'succeeded',
    status_reason: null,
    carried_over: false,
    listener_status: 'resolved',
    position: 0,
    execution_count: overrides.execution_count ?? executions.length,
    execution_status_counts: executionStatusCounts,
    default_execution: null,
    executions,
  };
  return {
    ...base,
    ...overrides,
  };
}

function runObservation(overrides: Partial<WorkflowRunObservation> = {}): WorkflowRunObservation {
  const attempt = {
    id: '88888888-8888-4888-8888-888888888888',
    workflow_run_id: '33333333-3333-4333-8333-333333333333',
    attempt: 1,
    status: 'succeeded' as const,
    created_at: timestamp,
    started_at: timestamp,
    finished_at: timestamp,
    rerun_mode: null,
  };
  return {
    id: '33333333-3333-4333-8333-333333333333',
    project_id: '11111111-1111-4111-8111-111111111111',
    definition_id: '22222222-2222-4222-8222-222222222222',
    number: 1,
    name: 'Listener workflow',
    workflow_name: 'Listener workflow',
    status: 'succeeded',
    origin: 'synced',
    dev_source: null,
    current_attempt: 1,
    latest_attempt: 1,
    trigger_provider: 'manual',
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_reference: null,
    created_at: timestamp,
    updated_at: timestamp,
    attempt,
    jobs: [listenerJob()],
    has_started_job_execution: true,
    ...overrides,
  };
}

describe('listener helper predicates', () => {
  test('finds the listener execution containing a delivery id', () => {
    const observation = runObservation({
      jobs: [
        listenerJob({
          executions: [
            execution({sequence: 1, trigger_events: [event({delivery_id: 'delivery-1'})]}),
            execution({sequence: 2, trigger_events: [event({delivery_id: 'delivery-2'})]}),
          ],
        }),
      ],
    });

    const result = findListenerExecutionByDeliveryId({
      observation,
      jobKey: 'listen',
      deliveryId: 'delivery-2',
    });

    expect(result?.sequence).toBe(2);
  });

  test('finds the listener execution containing any delivery id', () => {
    const observation = runObservation({
      jobs: [
        listenerJob({
          executions: [
            execution({sequence: 1, trigger_events: [event({delivery_id: 'delivery-1'})]}),
            execution({sequence: 2, trigger_events: [event({delivery_id: 'delivery-2'})]}),
          ],
        }),
      ],
    });

    const result = findListenerExecutionByDeliveryIds({
      observation,
      jobKey: 'listen',
      deliveryIds: ['delivery-3', 'delivery-2'],
    });

    expect(result?.deliveryId).toBe('delivery-2');
    expect(result?.execution.sequence).toBe(2);
  });

  test('reports a missing delivery with observed delivery ids', () => {
    const result = listenerDeliveryObserved({
      observation: runObservation(),
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
    const observation = runObservation({
      jobs: [
        listenerJob({
          executions: [
            execution({sequence: 1}),
            execution({id: '99999999-9999-4999-8999-999999999999', sequence: 2}),
          ],
        }),
      ],
    });

    const result = listenerExecutionCountMatches({observation, jobKey: 'listen', count: 2});

    expect(result.matched).toBe(true);
    expect(observation.jobs[0]?.execution_status_counts.succeeded).toBe(2);
  });

  test('matches listener resolution status', () => {
    const result = listenerResolutionMatches({
      observation: runObservation(),
      jobKey: 'listen',
      status: 'succeeded',
      reason: 'until',
    });

    expect(result.matched).toBe(true);
  });

  test('reports listener resolution mismatches', () => {
    const result = listenerResolutionMatches({
      observation: runObservation({
        jobs: [listenerJob({status: 'running', listener_status: 'listening'})],
      }),
      jobKey: 'listen',
      status: 'succeeded',
      reason: 'until',
    });

    expect(result).toEqual({
      matched: false,
      diagnostic:
        'listener job listen status=running, listenerStatus=listening, expected=succeeded/resolved (resolution reason until is not exposed by bounded overview)',
    });
  });

  test('matches a batched execution containing every expected delivery', () => {
    const result = batchedListenerExecutionMatches({
      observation: runObservation({
        jobs: [
          listenerJob({
            executions: [
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
