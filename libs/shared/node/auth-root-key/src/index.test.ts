import {vi} from '@shipfox/vitest/vi';

const ROOT_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('auth root key derivation', () => {
  test('derives stable, distinct 32-byte keys for every named use', async () => {
    vi.stubEnv('AUTH_ROOT_KEY', ROOT_KEY);

    const keys = await import('./index.js');
    const first = keys.userAccessTokenKey();
    const second = keys.userAccessTokenKey();

    expect(first).toEqual(second);
    expect(first).toHaveLength(32);
    expect(
      new Set(
        [
          first,
          keys.agentAccessTokenKey(),
          keys.jobLeaseTokenKey(),
          keys.runnerSessionTokenKey(),
          keys.rateLimitIdentifierKey(),
          keys.emailChallengeKey(),
        ].map((key) => Buffer.from(key).toString('hex')),
      ),
    ).toHaveLength(6);
    expect(Buffer.from(first).toString('hex')).toBe(
      'fab85cafc21c6a9580b7f93ec5cdd880cb3abf9ab22fcf9652029f8cf44c1c5a',
    );
  });

  test.each([
    undefined,
    'not-base64',
    'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZQ==',
    `${ROOT_KEY}=`,
    `${ROOT_KEY}\n`,
  ])('rejects an invalid AUTH_ROOT_KEY', async (value) => {
    if (value === undefined) vi.stubEnv('AUTH_ROOT_KEY', '');
    else vi.stubEnv('AUTH_ROOT_KEY', value);

    await expect(import('./index.js')).rejects.toThrow('AUTH_ROOT_KEY');
  });
});
