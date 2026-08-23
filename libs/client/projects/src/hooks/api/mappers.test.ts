import {toDefinitionSyncSummary} from './mappers.js';

describe('toDefinitionSyncSummary', () => {
  it('maps diagnostics with severity and preserves an absent path', () => {
    const summary = toDefinitionSyncSummary({
      ref: 'main',
      status: 'succeeded',
      last_sync_at: '2026-05-07T01:00:00.000Z',
      started_at: '2026-05-07T00:59:55.000Z',
      finished_at: '2026-05-07T01:00:00.000Z',
      last_error_code: null,
      last_error_message: null,
      diagnostics: [
        {code: 'warning-code', message: 'Warning without a path', severity: 'warning'},
        {
          code: 'error-code',
          message: 'Trigger error with a path',
          path: 'triggers.on_demand',
          severity: 'error',
        },
      ],
    });

    expect(summary.diagnostics).toEqual([
      {code: 'warning-code', message: 'Warning without a path', severity: 'warning'},
      {
        code: 'error-code',
        message: 'Trigger error with a path',
        path: 'triggers.on_demand',
        severity: 'error',
      },
    ]);
    expect(summary.diagnostics[0]).not.toHaveProperty('path');
  });
});
