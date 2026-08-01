import {RESOURCE_SLUG_PATTERN, slugifyName, slugSchema, withSlugSuffix} from './slug.js';

const expectedResourceSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe('slugSchema', () => {
  it.each(['acme', 'checkout-api', 'settings', 'new', 'a1'])('accepts %s', (value) => {
    expect(slugSchema.parse(value)).toBe(value);
  });

  it.each([
    '',
    'a',
    'AcmE',
    'checkout_api',
    '-checkout',
    'checkout-',
    'checkout--api',
    'a'.repeat(41),
  ])('rejects %s', (value) => {
    expect(() => slugSchema.parse(value)).toThrow();
  });

  it('uses the shared lowercase hyphenated pattern', () => {
    expect(RESOURCE_SLUG_PATTERN).toEqual(expectedResourceSlugPattern);
  });
});

describe('slugifyName', () => {
  it('lowercases, folds diacritics, and collapses non-alphanumeric runs', () => {
    expect(slugifyName('Équipe Renard \u2014 API', {fallback: 'workspace'})).toBe(
      'equipe-renard-api',
    );
  });

  it('trims hyphens and truncates to 40 characters', () => {
    expect(slugifyName(`  ${'a'.repeat(39)} name  `, {fallback: 'workspace'})).toBe('a'.repeat(39));
  });

  it.each(['A', '🚀', '漢字'])('uses the fallback when %s produces an invalid slug', (name) => {
    expect(slugifyName(name, {fallback: 'workspace'})).toBe('workspace');
  });
});

describe('withSlugSuffix', () => {
  it.each([
    ['workspace', 2, 'workspace-2'],
    ['project', 3, 'project-3'],
    ['a'.repeat(40), 2, `${'a'.repeat(38)}-2`],
  ])('adds the attempt suffix', (slug, attempt, expected) => {
    const suffixedSlug = withSlugSuffix(slug, attempt);

    expect(suffixedSlug).toBe(expected);
    expect(slugSchema.parse(suffixedSlug)).toBe(suffixedSlug);
  });
});
