import {RunnerLabelsReservedError} from './errors.js';
import {sanitizeRunnerLabels, sanitizeRunnerLabelsOrThrow} from './runner-labels.js';

describe('sanitizeRunnerLabels', () => {
  it('strips reserved labels from non-installation sources', () => {
    const labels = sanitizeRunnerLabels([' Linux ', 'shipfox-managed', 'linux'], {
      scope: 'workspace',
      source: 'test',
      reservedLabels: ['Shipfox-Managed'],
    });

    expect(labels).toEqual(['linux']);
  });

  it('preserves reserved labels for installation sources', () => {
    const labels = sanitizeRunnerLabels([' Linux ', 'shipfox-managed'], {
      scope: 'installation',
      source: 'test',
      reservedLabels: ['shipfox-managed'],
    });

    expect(labels).toEqual(['linux', 'shipfox-managed']);
  });

  it('does not change labels when no reserved labels are configured', () => {
    const labels = sanitizeRunnerLabels([' Linux ', 'linux'], {
      scope: 'manual',
      source: 'test',
      reservedLabels: [],
    });

    expect(labels).toEqual(['linux']);
  });

  it('uses the configured reserved labels when none are provided explicitly', () => {
    const labels = sanitizeRunnerLabels(['linux', 'shipfox-managed'], {
      scope: 'workspace',
      source: 'test',
    });

    expect(labels).toEqual(['linux']);
  });

  it('throws when sanitization removes every canonical label', () => {
    expect(() =>
      sanitizeRunnerLabelsOrThrow([' Shipfox-Managed '], {
        scope: 'workspace',
        source: 'test',
        reservedLabels: ['shipfox-managed'],
      }),
    ).toThrow(RunnerLabelsReservedError);
  });
});
