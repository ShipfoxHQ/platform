import {
  ALNUM_SLUG_RE,
  createShipfoxTokenPrefixRegexes,
  DISPLAY_NAME_DISALLOWED_CHARACTER_RE,
  hasDisplayNameDisallowedCharacter,
  isAlnumSlug,
  isLowercaseAlphaSlug,
  isLowercaseSha256Hex,
  isSafeRefInput,
  isUuid,
  LOWERCASE_ALPHA_SLUG_RE,
  LOWERCASE_SHA256_HEX_RE,
  UUID_RE,
} from './index.js';

describe('UUID_RE', () => {
  it.each([
    '028b2a9a-800e-485e-b33a-9af4e238508b',
    '028B2A9A-800E-485E-B33A-9AF4E238508B',
    '99999999-9999-9999-9999-999999999999',
  ])('accepts structural UUID %s', (value) => {
    const result = isUuid(value);

    expect(result).toBe(true);
  });

  it.each([
    'not-a-uuid',
    '028b2a9a800e485eb33a9af4e238508b',
    '028b2a9a-800e-485e-b33a-9af4e238508',
    '028b2a9a-800e-485e-b33a-9af4e238508z',
    '../escape',
  ])('rejects non-UUID %s', (value) => {
    const result = isUuid(value);

    expect(result).toBe(false);
  });
});

describe('slug matchers', () => {
  it.each(['github', 'debug_provider', 'sentry-2'])('accepts lowercase alpha slug %s', (value) => {
    const result = isLowercaseAlphaSlug(value);

    expect(result).toBe(true);
  });

  it.each([
    'GitHub',
    '2github',
    '_github',
    'github.provider',
    '',
  ])('rejects invalid lowercase alpha slug %s', (value) => {
    const result = isLowercaseAlphaSlug(value);

    expect(result).toBe(false);
  });

  it.each(['manual', 'GitHub', '2github', 'sentry_hook'])('accepts alnum slug %s', (value) => {
    const result = isAlnumSlug(value);

    expect(result).toBe(true);
  });

  it.each([
    '_manual',
    '-manual',
    'has spaces',
    'github.provider',
    '',
  ])('rejects invalid alnum slug %s', (value) => {
    const result = isAlnumSlug(value);

    expect(result).toBe(false);
  });
});

describe('LOWERCASE_SHA256_HEX_RE', () => {
  it('accepts lowercase SHA-256 hex digests', () => {
    const result = isLowercaseSha256Hex('a'.repeat(64));

    expect(result).toBe(true);
  });

  it.each([
    'a'.repeat(63),
    'a'.repeat(65),
    `${'a'.repeat(63)}z`,
    'A'.repeat(64),
  ])('rejects %s', (value) => {
    const result = isLowercaseSha256Hex(value);

    expect(result).toBe(false);
  });
});

describe('display name character matcher', () => {
  it.each([
    ['newline', 'Acme\nPlatform'],
    ['tab', 'Acme\tPlatform'],
    ['NUL', 'Acme\0Platform'],
    ['escape', 'Acme\u001b[31mPlatform'],
    ['right-to-left override', 'Acme\u202ePlatform'],
    ['zero-width joiner', 'Acme\u200dPlatform'],
  ])('matches a %s character', (_name, value) => {
    const result = hasDisplayNameDisallowedCharacter(value);

    expect(result).toBe(true);
  });

  it.each([
    'Acme Platform',
    'Équipe Renard 🚀',
  ])('does not match visible display name %s', (value) => {
    const result = hasDisplayNameDisallowedCharacter(value);

    expect(result).toBe(false);
  });
});

describe('safe ref input matcher', () => {
  it.each([
    'main',
    'refs/heads/fix-triage-prompt',
    'release/v1.0 🚀',
  ])('accepts visible ref %s', (value) => {
    expect(isSafeRefInput(value)).toBe(true);
  });

  it.each([
    'main\n',
    'main\u0000',
    'main\u0085',
    'main\u2028',
  ])('rejects control characters in %s', (value) => {
    expect(isSafeRefInput(value)).toBe(false);
  });
});

describe('createShipfoxTokenPrefixRegexes', () => {
  it('matches unqualified and environment-qualified token prefixes', () => {
    const regexes = createShipfoxTokenPrefixRegexes(['k', 'mrt', 'pr']);

    const unqualified = 'sf_mrt_secret'.match(regexes.unqualified);
    const qualified = 'sf_staging_k_secret'.match(regexes.qualified);

    expect(unqualified?.[1]).toBe('mrt');
    expect(qualified?.[1]).toBe('staging');
    expect(qualified?.[2]).toBe('k');
  });

  it('escapes token parts before building the regex', () => {
    const regexes = createShipfoxTokenPrefixRegexes(['a+b']);

    expect('sf_a+b_secret'.match(regexes.unqualified)?.[1]).toBe('a+b');
    expect('sf_aaab_secret'.match(regexes.unqualified)).toBeNull();
  });

  it('rejects an empty token type part list', () => {
    const create = () => createShipfoxTokenPrefixRegexes([]);

    expect(create).toThrow('At least one Shipfox token type part is required');
  });
});

describe('exported regexes', () => {
  it.each([
    ['UUID_RE', UUID_RE, '028b2a9a-800e-485e-b33a-9af4e238508b'],
    ['LOWERCASE_ALPHA_SLUG_RE', LOWERCASE_ALPHA_SLUG_RE, 'github'],
    ['ALNUM_SLUG_RE', ALNUM_SLUG_RE, 'GitHub'],
    ['LOWERCASE_SHA256_HEX_RE', LOWERCASE_SHA256_HEX_RE, 'a'.repeat(64)],
    ['DISPLAY_NAME_DISALLOWED_CHARACTER_RE', DISPLAY_NAME_DISALLOWED_CHARACTER_RE, '\u202e'],
  ])('%s is stable across repeated test calls', (_name, regex, value) => {
    const first = regex.test(value);
    const second = regex.test(value);

    expect(first).toBe(true);
    expect(second).toBe(true);
  });
});
