import {PrerequisiteLedger} from '#core/prerequisite-ledger.js';

describe('PrerequisiteLedger', () => {
  it('starts with only caller-supplied prerequisites satisfied', () => {
    const ledger = new PrerequisiteLedger({
      required: ['pull_request_read.get_diff'],
      satisfied: [],
    });

    expect(ledger.missing()).toEqual(['pull_request_read.get_diff']);
    expect(ledger.isComplete()).toBe(false);
  });

  it('records a successful matching integration tool call', () => {
    const ledger = new PrerequisiteLedger({required: ['pull_request_read.get_diff']});

    ledger.recordToolSuccess('github_main__pull_request_read', {method: 'get_diff'});

    expect(ledger.missing()).toEqual([]);
    expect(ledger.isComplete()).toBe(true);
  });

  it('does not infer a prerequisite from a similarly named tool or wrong method', () => {
    const ledger = new PrerequisiteLedger({
      required: [{id: 'read-diff', toolName: 'pull_request_read', method: 'get_diff'}],
    });

    ledger.recordToolSuccess('pull_request_read', {method: 'get'});

    expect(ledger.isComplete()).toBe(false);
  });

  it('supports exact argument-gated prerequisites', () => {
    const ledger = new PrerequisiteLedger({
      required: [
        {
          id: 'read-target-diff',
          toolName: 'pull_request_read',
          method: 'get_diff',
          arguments: {pull_number: 42},
        },
      ],
    });

    ledger.recordToolSuccess('pull_request_read', {method: 'get_diff', pull_number: 41});
    expect(ledger.isComplete()).toBe(false);

    ledger.recordToolSuccess('pull_request_read', {method: 'get_diff', pull_number: 42});
    expect(ledger.isComplete()).toBe(true);
  });
});
