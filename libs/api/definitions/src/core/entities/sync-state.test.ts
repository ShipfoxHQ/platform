import {DEFINITION_SYNC_WARNINGS_MAX_COUNT} from '@shipfox/api-definitions-dto';
import {type DefinitionSyncDiagnostic, limitDefinitionSyncDiagnostics} from './sync-state.js';

describe('limitDefinitionSyncDiagnostics', () => {
  it('orders errors before warnings while keeping the order within each severity', () => {
    const diagnostics: DefinitionSyncDiagnostic[] = [
      {code: 'warning-a', message: 'first warning', severity: 'warning'},
      {code: 'error-a', message: 'first error', severity: 'error'},
      {code: 'warning-b', message: 'second warning', severity: 'warning'},
      {code: 'error-b', message: 'second error', severity: 'error'},
    ];

    expect(limitDefinitionSyncDiagnostics(diagnostics).map((entry) => entry.code)).toEqual([
      'error-a',
      'error-b',
      'warning-a',
      'warning-b',
    ]);
  });

  it('drops warnings first when the list exceeds the maximum count', () => {
    const diagnostics: DefinitionSyncDiagnostic[] = [
      ...Array.from({length: DEFINITION_SYNC_WARNINGS_MAX_COUNT}, (_, index) => ({
        code: `warning-${index}`,
        message: `warning ${index}`,
        severity: 'warning' as const,
      })),
      {code: 'error-last', message: 'error persisted', severity: 'error'},
    ];

    const limited = limitDefinitionSyncDiagnostics(diagnostics);

    expect(limited).toHaveLength(DEFINITION_SYNC_WARNINGS_MAX_COUNT);
    expect(limited[0]?.code).toBe('error-last');
    expect(limited.filter((entry) => entry.severity === 'error')).toHaveLength(1);
    expect(limited.some((entry) => entry.code === 'warning-0')).toBe(true);
    expect(
      limited.some((entry) => entry.code === `warning-${DEFINITION_SYNC_WARNINGS_MAX_COUNT - 1}`),
    ).toBe(false);
  });

  it('preserves severity and an absent path', () => {
    expect(
      limitDefinitionSyncDiagnostics([{code: 'code', message: 'message', severity: 'warning'}]),
    ).toEqual([{code: 'code', message: 'message', severity: 'warning'}]);
  });
});
