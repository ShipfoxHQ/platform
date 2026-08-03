import {normalizeWorkflowExecutionEvent} from './job-execution.js';

describe('normalizeWorkflowExecutionEvent', () => {
  it('fills null reference fields for legacy persisted events', () => {
    const legacyEvent = {
      source: 'github',
      event: 'push',
      delivery_id: 'delivery-1',
      received_at: '2026-07-20T12:00:00.000Z',
      data: {ref: 'refs/heads/main'},
    };

    expect(normalizeWorkflowExecutionEvent(legacyEvent)).toEqual({
      ...legacyEvent,
      project: null,
      repository: null,
      ref: null,
      commit: null,
    });
  });
});
