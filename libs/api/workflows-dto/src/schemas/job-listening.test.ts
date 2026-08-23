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

  it('parses listener matchers with the event omitted', () => {
    const input = {
      on: [{source: 'github_acme'}],
      until: [{source: 'github_acme', filter: 'event.action == "closed"'}],
      timeout_ms: 1000,
      max_executions: 3,
      batch: null,
      on_resolve: 'finish',
      execution_timeout_ms: null,
      name: null,
    };

    const result = jobListeningSchema.parse(input);

    expect(result.on).toEqual([{source: 'github_acme'}]);
    expect(result.until?.[0]).toEqual({
      source: 'github_acme',
      filter: 'event.action == "closed"',
    });
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
