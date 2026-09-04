describe('integration provider config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('enables built-in providers by default', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.INTEGRATIONS_ENABLE_CRON_PROVIDER).toBe(true);
    expect(config.INTEGRATIONS_ENABLE_WEBHOOK_PROVIDER).toBe(true);
  });

  it('disables the Linear provider by default', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.INTEGRATIONS_ENABLE_LINEAR_PROVIDER).toBe(false);
  });

  it('allows disabling the built-in cron provider', async () => {
    vi.stubEnv('INTEGRATIONS_ENABLE_CRON_PROVIDER', 'false');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.INTEGRATIONS_ENABLE_CRON_PROVIDER).toBe(false);
  });
});
