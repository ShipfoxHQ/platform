describe('signup gate configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test('uses the Auth-prefixed defaults', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.AUTH_SIGNUP_GATE_ENABLED).toBe(false);
    expect(config.AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS).toBe('');
    expect(config.AUTH_SIGNUP_ALLOWED_EMAILS).toBe('');
    expect(config.AUTH_SIGNUP_NOT_ALLOWED_MESSAGE).toBeUndefined();
  });

  test('requires the public API URL', async () => {
    vi.stubEnv('API_PUBLIC_URL', undefined);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('process.exit unexpectedly called with "1"');
  });

  test('accepts an HTTPS public API URL', async () => {
    vi.stubEnv('API_PUBLIC_URL', 'https://api.example.test');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.API_PUBLIC_URL).toBe('https://api.example.test');
  });

  test('rejects a public API URL without a scheme', async () => {
    vi.stubEnv('API_PUBLIC_URL', 'api.example.test');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('process.exit unexpectedly called with "1"');
  });

  test('fails startup when the enabled gate has no allowlist', async () => {
    vi.stubEnv('AUTH_SIGNUP_GATE_ENABLED', 'true');
    vi.stubEnv('AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS', ',  ');
    vi.stubEnv('AUTH_SIGNUP_ALLOWED_EMAILS', ' , ');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'AUTH_SIGNUP_GATE_ENABLED requires AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS or AUTH_SIGNUP_ALLOWED_EMAILS',
    );
  });

  test('accepts an enabled gate with either allowlist', async () => {
    vi.stubEnv('AUTH_SIGNUP_GATE_ENABLED', 'true');
    vi.stubEnv('AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS', 'shipfox.io');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.AUTH_SIGNUP_GATE_ENABLED).toBe(true);
    expect(config.AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS).toBe('shipfox.io');
  });

  test('rejects a Markdown denial message that exceeds the response limit', async () => {
    vi.stubEnv(
      'AUTH_SIGNUP_NOT_ALLOWED_MESSAGE',
      `${'x'.repeat(499)}[Request access](https://example.test/access)`,
    );
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'AUTH_SIGNUP_NOT_ALLOWED_MESSAGE must contain at most 500 characters',
    );
  });
});
