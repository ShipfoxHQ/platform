import {
  buildProviderRepositoryId,
  IntegrationProviderError,
  isValidGitObjectId,
  isValidGitRefName,
  isValidTriggerRef,
  parseProviderRepositoryId,
} from './contracts.js';

describe('git ref names', () => {
  it.each([
    'refs/heads/main',
    'refs/heads/feature/review',
    'refs/heads/foo./bar',
    'refs/heads/foo/-bar',
    'refs/pull/17/head',
  ])('accepts %s', (ref) => {
    expect(isValidGitRefName(ref)).toBe(true);
  });

  it.each([
    '',
    'HEAD',
    'main',
    '-main',
    'refs/heads/foo bar',
    'refs/heads/foo..bar',
    'refs/heads/foo.lock',
    'refs/heads/.foo',
    'refs/heads/foo.',
    'refs/heads/foo@{bar',
  ])('rejects %s', (ref) => {
    expect(isValidGitRefName(ref)).toBe(false);
  });

  it.each(['refs/tags/-evil', 'refs/heads/feature/-evil'])('accepts safe trigger ref %s', (ref) => {
    expect(isValidTriggerRef(ref)).toBe(true);
  });
});

describe('git object ids', () => {
  it.each(['a'.repeat(40), 'b'.repeat(64)])('accepts a full object id', (value) => {
    expect(isValidGitObjectId(value)).toBe(true);
  });

  it.each([
    'a',
    'abcdef1234567890',
    '0'.repeat(40),
    'g'.repeat(40),
  ])('rejects an invalid object id', (value) => {
    expect(isValidGitObjectId(value)).toBe(false);
  });
});

describe('provider repository identifiers', () => {
  it('prefixes provider-owned identifiers', () => {
    const result = buildProviderRepositoryId('github', '42');

    expect(result).toBe('github:42');
  });

  it('returns a provider-owned value without splitting nested separators', () => {
    const result = parseProviderRepositoryId('github:org/repo:extra', 'github');

    expect(result).toBe('org/repo:extra');
  });

  it.each(['42', ':42', 'gitlab:42', 'github:'])('rejects invalid identifier %s', (value) => {
    const parse = () => parseProviderRepositoryId(value, 'github');

    expect(parse).toThrow(IntegrationProviderError);
  });
});
