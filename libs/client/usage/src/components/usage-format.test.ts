import {formatUsageDuration} from './usage-format.js';

describe('formatUsageDuration', () => {
  test.each([
    [59.6, '1m 0s'],
    [119.6, '2m 0s'],
    [3_599.6, '1h 0m'],
  ])('rounds %s before deriving time units', (seconds, expected) => {
    expect(formatUsageDuration(seconds)).toBe(expected);
  });

  test.each([null, undefined, Number.NaN, -1])('rejects invalid duration %s', (seconds) => {
    expect(formatUsageDuration(seconds)).toBe('—');
  });
});
