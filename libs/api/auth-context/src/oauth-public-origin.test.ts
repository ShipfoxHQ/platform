import {InvalidOAuthPublicOriginError, normalizeOAuthPublicOrigin} from './oauth-public-origin.js';

describe('normalizeOAuthPublicOrigin', () => {
  test.each([
    ['https://api.example.test/', 'https://api.example.test'],
    ['http://localhost:16101/', 'http://localhost:16101'],
    ['http://127.0.0.1:16101', 'http://127.0.0.1:16101'],
    ['http://[::1]:16101', 'http://[::1]:16101'],
  ])('normalizes an HTTPS or loopback origin: %s', (value, expected) => {
    expect(normalizeOAuthPublicOrigin(value)).toBe(expected);
  });

  test.each([
    'http://api.example.test',
    'https://api.example.test/v1',
    'https://user:password@api.example.test',
    ' https://api.example.test',
    'https://api.example.test?region=eu',
    'https://api.example.test#fragment',
    'https://api.example.test/\u0001',
    'https://api.example.test/\u007f',
  ])('rejects an unsafe public origin: %s', (value) => {
    expect(() => normalizeOAuthPublicOrigin(value)).toThrow(InvalidOAuthPublicOriginError);
  });
});
