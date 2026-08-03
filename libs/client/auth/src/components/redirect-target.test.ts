import {sanitizeLogoutRedirectPath, sanitizeRedirectPath} from './redirect-target.js';

function encodeRepeatedly(value: string, times: number): string {
  let encoded = value;
  for (let iteration = 0; iteration < times; iteration += 1) {
    encoded = encodeURIComponent(encoded);
  }
  return encoded;
}

describe('sanitizeRedirectPath', () => {
  describe.each([
    ['simple absolute path', '/foo'],
    ['nested workspace path', '/w/abc/p/xyz'],
    ['path with search', '/foo?bar=1'],
    ['path with hash', '/foo#hash'],
    ['path with search and hash', '/w/abc?tab=runs#header'],
  ])('accepts %s', (_label, input) => {
    test('returns the original string', () => {
      const result = sanitizeRedirectPath(input);

      expect(result).toBe(input);
    });
  });

  describe.each([
    ['undefined', undefined],
    ['null', null],
    ['number', 42],
    ['empty string', ''],
    ['no leading slash', 'foo'],
    ['protocol-relative URL', '//evil.com'],
    ['triple-slash URL', '///evil.com'],
    ['backslash external URL', '/\\evil.com'],
    ['absolute https URL', 'https://evil.com'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['plain /auth/login', '/auth/login'],
    ['/auth bare', '/auth'],
    ['/auth/reset with token', '/auth/reset?token=x'],
    ['/auth with query bypass', '/auth?token=x'],
    ['/auth with fragment bypass', '/auth#foo'],
    ['normalized auth path', '/w/../auth/logout'],
  ])('rejects %s', (_label, input) => {
    test('returns undefined', () => {
      const result = sanitizeRedirectPath(input);

      expect(result).toBeUndefined();
    });
  });

  describe('decode-then-check defenses', () => {
    test.each([
      ['single-encoded', '/%61uth/login'],
      ['double-encoded', '/%2561uth/login'],
      ['triple-encoded', '/%252561uth/login'],
    ])('rejects %s /auth/* path', (_label, input) => {
      const result = sanitizeRedirectPath(input);

      expect(result).toBeUndefined();
    });

    test('rejects percent-encoded protocol-relative URL', () => {
      const result = sanitizeRedirectPath('/%2fevil.com');

      expect(result).toBeUndefined();
    });

    test('rejects a percent-encoded normalized auth path', () => {
      const result = sanitizeRedirectPath('/w/%2e%2e/auth/logout');

      expect(result).toBeUndefined();
    });

    test('rejects malformed percent-encoded input', () => {
      const result = sanitizeRedirectPath('/%E0%80%80');

      expect(result).toBeUndefined();
    });

    test('fails closed when the path exceeds the decode iteration cap', () => {
      const deeplyEncodedAuthPath = `/${encodeRepeatedly('%61', 10)}uth/login`;

      expect(sanitizeRedirectPath(deeplyEncodedAuthPath)).toBeUndefined();
    });

    test('rejects malformed percent-encoding that only surfaces after the first decode', () => {
      const result = sanitizeRedirectPath('/%25E0%2580%2580');

      expect(result).toBeUndefined();
    });

    test('rejects an /auth/* path disguised behind encoded dot segments', () => {
      const result = sanitizeRedirectPath('/safe/%25252e%25252e/auth/login');

      expect(result).toBeUndefined();
    });

    test('rejects a protocol-relative URL revealed only after multiple decodes', () => {
      const result = sanitizeRedirectPath('/%25252fevil.com');

      expect(result).toBeUndefined();
    });
  });
});

describe('sanitizeLogoutRedirectPath', () => {
  describe.each([
    ['explicit login fallback', '/auth/login', '/auth/login'],
    ['same-origin workspace path', '/w/abc', '/w/abc'],
    ['same-origin path with search and hash', '/w/abc?tab=runs#header', '/w/abc?tab=runs#header'],
  ])('accepts %s', (_label, input, expected) => {
    test('returns the safe destination', () => {
      expect(sanitizeLogoutRedirectPath(input)).toBe(expected);
    });
  });

  describe.each([
    ['missing redirect', undefined],
    ['external URL', 'https://attacker.example'],
    ['protocol-relative URL', '//attacker.example'],
    ['auth route other than login', '/auth/reset'],
    ['login route with a query', '/auth/login?redirect=/w/abc'],
    ['raw invitation token', '/invitations/accept?token=sf_i_raw-token'],
    ['raw invitation token with trailing slash', '/invitations/accept/?token=sf_i_raw-token'],
    ['double-encoded auth route', '/%2561uth/login'],
    ['triple-encoded auth route', '/%252561uth/login'],
    ['double-encoded invitation token', '/%2569nvitations/accept?token=sf_i_raw-token'],
    ['triple-encoded invitation token', '/%252569nvitations/accept?token=sf_i_raw-token'],
    ['malformed percent encoding', '/%E0%80%80'],
    [
      'invitation token disguised behind encoded dot segments',
      '/safe/%25252e%25252e/invitations/accept?token=sf_i_raw-token',
    ],
    ['auth route disguised behind encoded dot segments', '/safe/%25252e%25252e/auth/login'],
  ])('falls back for %s', (_label, input) => {
    test('returns login without forwarding unsafe state', () => {
      expect(sanitizeLogoutRedirectPath(input)).toBe('/auth/login');
    });
  });
});
