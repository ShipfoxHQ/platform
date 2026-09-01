import {describe, expect, it} from '@shipfox/vitest/vi';
import {normalizeGithubApiBaseUrl} from './config.js';

describe('normalizeGithubApiBaseUrl', () => {
  it.each([
    ['https://api.github.com', 'https://api.github.com'],
    ['https://api.github.com/', 'https://api.github.com'],
    ['https://github.example.test/api/v3///', 'https://github.example.test/api/v3'],
  ])('normalizes %s', (baseUrl, expected) => {
    const result = normalizeGithubApiBaseUrl(baseUrl);

    expect(result).toBe(expected);
  });
});

describe('GitHub checkout token cache config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('enables the exact-scope cache by default', async () => {
    vi.stubEnv('GITHUB_CHECKOUT_TOKEN_CACHE_ENABLED', 'true');
    vi.resetModules();

    const {config} = await import('./config.js');

    expect(config.GITHUB_CHECKOUT_TOKEN_CACHE_ENABLED).toBe(true);
  });

  it('allows direct minting to be restored with the switch disabled', async () => {
    vi.stubEnv('GITHUB_CHECKOUT_TOKEN_CACHE_ENABLED', 'false');
    vi.resetModules();

    const {config} = await import('./config.js');

    expect(config.GITHUB_CHECKOUT_TOKEN_CACHE_ENABLED).toBe(false);
  });

  it('does not construct the cache when the switch is disabled', async () => {
    vi.stubEnv('GITHUB_CHECKOUT_TOKEN_CACHE_ENABLED', 'false');
    vi.resetModules();

    const {createGithubCheckoutTokenCache} = await import('./api/github-checkout-token-cache.js');

    expect(createGithubCheckoutTokenCache()).toBeUndefined();
  });
});
