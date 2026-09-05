import type {DefinitionSyncSummaryDto} from '@shipfox/api-definitions-dto';
import {evaluateRejection, parseRejection} from './reject.js';

const timestamp = '2026-07-04T10:00:00.000Z';

function sync(overrides: Partial<DefinitionSyncSummaryDto> = {}): DefinitionSyncSummaryDto {
  return {
    ref: 'main',
    status: 'failed',
    last_sync_at: timestamp,
    started_at: timestamp,
    finished_at: timestamp,
    last_error_code: 'invalid-definition',
    last_error_message: 'Invalid workflow definition: unknown-interpolation-context',
    diagnostics: [],
    ...overrides,
  };
}

describe('parseRejection', () => {
  test('defaults the expected sync error code', () => {
    const rejection = parseRejection({message_includes: ['unknown-interpolation-context']});

    expect(rejection).toEqual({
      error_code: 'invalid-definition',
      message_includes: ['unknown-interpolation-context'],
    });
  });

  test('rejects unknown manifest keys', () => {
    const act = () => parseRejection({message_includes: [], timeout_seconds: 5});

    expect(act).toThrow();
  });

  test('rejects empty message substrings', () => {
    const act = () => parseRejection({message_includes: ['']});

    expect(act).toThrow();
  });
});

describe('evaluateRejection', () => {
  test('reports no mismatches for a failed sync with matching message and no runs', () => {
    const result = evaluateRejection(
      {sync: sync(), runs: []},
      parseRejection({message_includes: ['unknown-interpolation-context']}),
    );

    expect(result).toEqual([]);
  });

  test('reports sync status, error code, message, and run mismatches together', () => {
    const result = evaluateRejection(
      {
        sync: sync({
          status: 'succeeded',
          last_error_code: null,
          last_error_message: 'accepted',
        }),
        runs: [{id: '33333333-3333-4333-8333-333333333333'}],
      },
      parseRejection({message_includes: ['unknown-interpolation-context']}),
    );

    expect(result).toEqual([
      {path: 'definition.sync.status', expected: 'failed', actual: 'succeeded'},
      {
        path: 'definition.sync.last_error_code',
        expected: 'invalid-definition',
        actual: 'null',
      },
      {
        path: 'definition.sync.last_error_message',
        expected: 'include unknown-interpolation-context',
        actual: 'accepted',
      },
      {path: 'runs', expected: 'none', actual: '1'},
    ]);
  });

  test('reports missing sync state as mismatches', () => {
    const result = evaluateRejection(
      {sync: null, runs: []},
      parseRejection({message_includes: ['unknown-interpolation-context']}),
    );

    expect(result).toEqual([
      {path: 'definition.sync.status', expected: 'failed', actual: 'null'},
      {
        path: 'definition.sync.last_error_code',
        expected: 'invalid-definition',
        actual: 'null',
      },
      {
        path: 'definition.sync.last_error_message',
        expected: 'include unknown-interpolation-context',
        actual: 'null',
      },
    ]);
  });
});
