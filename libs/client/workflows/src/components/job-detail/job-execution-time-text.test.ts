import {formatJobExecutionTime} from './job-execution-time-text.js';

const FROM_ISO = '2026-08-15T08:51:00.000Z';
const FROM_MS = Date.parse(FROM_ISO);

describe('formatJobExecutionTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test.each([
    [999, '0s'],
    [37_999, '37s'],
    [60_000, '1m 00s'],
    [124_999, '2m 04s'],
    [3_780_999, '1h 03m'],
  ])('formats a live %i ms timer as %s', (elapsedMs, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(FROM_MS + elapsedMs);

    const result = formatJobExecutionTime({
      state: 'live',
      fromIso: FROM_ISO,
    });

    expect(result).toBe(expected);
  });

  test('falls back to zero seconds for an invalid live timestamp', () => {
    const result = formatJobExecutionTime({state: 'live', fromIso: 'not-a-date'});

    expect(result).toBe('0s');
  });

  test.each([
    [{seconds: 37}, '37s'],
    [{minutes: 1}, '1m 00s'],
    [{minutes: 2, seconds: 4}, '2m 04s'],
    [{hours: 1}, '1h 00m'],
    [{hours: 1, minutes: 3}, '1h 03m'],
  ])('formats a fixed timer consistently as %s', (elapsed, expected) => {
    const result = formatJobExecutionTime({state: 'fixed', elapsed});

    expect(result).toBe(expected);
  });
});
