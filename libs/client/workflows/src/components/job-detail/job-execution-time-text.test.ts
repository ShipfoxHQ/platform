import {formatJobExecutionTime} from './job-execution-time-text.js';

describe('formatJobExecutionTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('formats live timers as whole seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T08:51:37.300Z');

    const result = formatJobExecutionTime({
      state: 'live',
      fromIso: '2026-08-15T08:51:00.000Z',
    });

    expect(result).toBe('37s');
  });
});
