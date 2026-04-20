import {getAuthRefreshDelayMs} from './refresh-auth.js';

const BASE64_PADDING_RE = /=+$/;

function jwtWithPayload(payload: unknown): string {
  const encodedPayload = btoa(JSON.stringify(payload))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(BASE64_PADDING_RE, '');
  return `header.${encodedPayload}.signature`;
}

describe('getAuthRefreshDelayMs', () => {
  test('returns the delay five minutes before the token expires', () => {
    const nowMs = Date.UTC(2026, 3, 29, 12, 0, 0);
    const token = jwtWithPayload({exp: nowMs / 1000 + 15 * 60});

    const result = getAuthRefreshDelayMs(token, nowMs);

    expect(result).toBe(10 * 60 * 1000);
  });

  test('returns zero or less for tokens inside the refresh window', () => {
    const nowMs = Date.UTC(2026, 3, 29, 12, 0, 0);
    const token = jwtWithPayload({exp: nowMs / 1000 + 4 * 60});

    const result = getAuthRefreshDelayMs(token, nowMs);

    expect(result).toBeLessThanOrEqual(0);
  });

  test('ignores tokens without a readable expiration claim', () => {
    const result = getAuthRefreshDelayMs('not-a-jwt', Date.UTC(2026, 3, 29, 12, 0, 0));

    expect(result).toBeUndefined();
  });
});
