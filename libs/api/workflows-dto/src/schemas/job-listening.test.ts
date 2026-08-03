import {
  jobListeningSchema,
  triggerEventsBatchSchema,
  workflowExecutionContextSchema,
} from './job-listening.js';

describe('jobListeningSchema', () => {
  it('parses listener config payloads unchanged', () => {
    const displayName = ['Review $', '{{ execution.index }}'].join('');
    const input = {
      on: [{source: 'github', event: 'pull_request_review'}],
      until: [{source: 'github', event: 'pull_request'}],
      timeout_ms: 1000,
      max_executions: 3,
      batch: {debounce_ms: 1000, max_size: 10, max_wait_ms: 5000},
      on_resolve: 'finish',
      execution_timeout_ms: null,
      name: displayName,
    };

    const result = jobListeningSchema.parse(input);

    expect(result).toEqual(input);
  });
});

describe('execution context schemas', () => {
  it('parses execution namespace payloads with event batches', () => {
    const event = {
      source: 'github',
      event: 'pull_request_review',
      delivery_id: 'delivery-1',
      received_at: '2026-06-25T00:00:00.000Z',
      project: null,
      repository: null,
      ref: null,
      commit: null,
      data: {body: 'LGTM'},
    };

    const execution = workflowExecutionContextSchema.parse({
      index: 0,
      name: 'Review #1',
      status: 'succeeded',
      started_at: '2026-06-25T00:00:00.000Z',
      finished_at: null,
      events: [event],
    });
    const batch = triggerEventsBatchSchema.parse({events: [event]});

    expect(execution.events).toEqual([event]);
    expect(batch.events).toEqual([event]);
  });

  it('rejects negative execution indexes', () => {
    const parse = () =>
      workflowExecutionContextSchema.parse({
        index: -1,
        name: 'Review #-1',
        status: 'succeeded',
        started_at: '2026-06-25T00:00:00.000Z',
        finished_at: null,
        events: [],
      });

    expect(parse).toThrow();
  });
});
