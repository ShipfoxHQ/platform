import {describe, expect, it} from '@shipfox/vitest/vi';
import {resolveDestinationLevel} from './config.js';

describe('resolveDestinationLevel', () => {
  it('defaults a destination to the global level', () => {
    expect(resolveDestinationLevel(undefined, 'info', 'LOG_STDOUT_LEVEL')).toBe('info');
  });

  it('allows a destination to be more restrictive', () => {
    expect(resolveDestinationLevel('warn', 'info', 'LOG_STDOUT_LEVEL')).toBe('warn');
  });

  it('rejects a destination that is more verbose than the global level', () => {
    expect(() => resolveDestinationLevel('debug', 'info', 'LOG_STDOUT_LEVEL')).toThrow(
      'LOG_STDOUT_LEVEL cannot be more verbose than LOG_LEVEL',
    );
  });
});
