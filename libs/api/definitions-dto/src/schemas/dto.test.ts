import {
  DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT,
  definitionAtRefQuerySchema,
  definitionAtRefResponseSchema,
  definitionSyncSummarySchema,
} from './dto.js';

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

describe('definitionAtRefResponseSchema', () => {
  test('round trips a listing with valid and invalid files', () => {
    const input = {
      ref: 'fix-branch',
      commit: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
      files: [
        {
          config_path: '.shipfox/workflows/ci.yml',
          name: 'CI',
          valid: true,
          errors: [],
          warnings: [
            {
              code: 're-evaluating-command',
              message: 'Workflow data is re-executed as shell code.',
              path: 'jobs.build.steps.0.run',
            },
          ],
          triggers: {on_demand: {source: 'manual', event: 'fire'}},
        },
        {
          config_path: '.shipfox/workflows/broken.yml',
          name: null,
          valid: false,
          errors: [{message: 'Invalid workflow definition', path: undefined}],
          warnings: [],
          triggers: {},
        },
      ],
    };

    expect(definitionAtRefResponseSchema.parse(input)).toEqual(input);
  });

  test('rejects a missing commit', () => {
    expect(() =>
      definitionAtRefResponseSchema.parse({
        ref: 'fix-branch',
        files: [],
      }),
    ).toThrow();
  });

  test('bounds per-file diagnostics', () => {
    const baseFile = {
      config_path: '.shipfox/workflows/ci.yml',
      name: 'CI',
      valid: false,
      errors: [],
      warnings: [],
      triggers: {},
    };
    const tooManyErrors = {
      ...baseFile,
      errors: Array.from({length: DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT + 1}, () => ({
        message: 'Invalid workflow',
      })),
    };

    expect(() =>
      definitionAtRefResponseSchema.parse({
        ref: 'fix-branch',
        commit: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0',
        files: [tooManyErrors],
      }),
    ).toThrow();
  });
});

describe('definitionAtRefQuerySchema', () => {
  test('rejects control characters in refs', () => {
    expect(() =>
      definitionAtRefQuerySchema.parse({
        project_id: '00000000-0000-4000-8000-000000000001',
        ref: 'main\n',
      }),
    ).toThrow();
  });
});
