import {definitionSyncSummarySchema} from './dto.js';

describe('definitionSyncSummarySchema', () => {
  test('round trips diagnostics with mixed severities', () => {
    const input = {
      ref: 'main',
      status: 'succeeded',
      last_sync_at: '2026-05-07T01:00:00.000Z',
      started_at: '2026-05-07T00:59:55.000Z',
      finished_at: '2026-05-07T01:00:00.000Z',
      last_error_code: null,
      last_error_message: null,
      diagnostics: [
        {
          code: 'invalid-trigger-event',
          message: 'Trigger event is never delivered.',
          path: 'triggers.on_deploy',
          file_path: '.shipfox/workflows/deploy.yml',
          severity: 'error',
        },
        {
          code: 're-evaluating-command',
          message: 'Workflow data is re-executed as shell code.',
          path: 'jobs.build.steps.0.run',
          severity: 'warning',
        },
      ],
    };

    expect(definitionSyncSummarySchema.parse(input)).toEqual(input);
  });

  test('round trips diagnostics without a path', () => {
    const input = {
      ref: 'main',
      status: 'succeeded',
      last_sync_at: '2026-05-07T01:00:00.000Z',
      started_at: '2026-05-07T00:59:55.000Z',
      finished_at: '2026-05-07T01:00:00.000Z',
      last_error_code: null,
      last_error_message: null,
      diagnostics: [{code: 'warning-code', message: 'Warning without a path', severity: 'warning'}],
    };

    expect(definitionSyncSummarySchema.parse(input)).toEqual(input);
  });

  test('rejects diagnostics without severity', () => {
    expect(() =>
      definitionSyncSummarySchema.parse({
        ref: 'main',
        status: 'succeeded',
        last_sync_at: '2026-05-07T01:00:00.000Z',
        started_at: null,
        finished_at: null,
        last_error_code: null,
        last_error_message: null,
        diagnostics: [{code: 'warning-code', message: 'Missing severity'}],
      }),
    ).toThrow();
  });
});
