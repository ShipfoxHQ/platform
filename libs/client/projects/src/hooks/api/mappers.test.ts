import {toDefinitionSyncSummary} from './mappers.js';

describe('toDefinitionSyncSummary', () => {
  it('preserves warnings without manufacturing a missing path', () => {
    const summary = toDefinitionSyncSummary({
      ref: 'main',
      status: 'succeeded',
      last_sync_at: '2026-05-07T01:00:00.000Z',
      started_at: '2026-05-07T00:59:55.000Z',
      finished_at: '2026-05-07T01:00:00.000Z',
      last_error_code: null,
      last_error_message: null,
      warnings: [{code: 'warning-code', message: 'Warning without a path'}],
    });

    expect(summary.warnings).toEqual([{code: 'warning-code', message: 'Warning without a path'}]);
    expect(summary.warnings[0]).not.toHaveProperty('path');
  });
});
