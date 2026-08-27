describe('poll config validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('fails startup when SHIPFOX_POLL_MAX_DURATION_MS is negative', async () => {
    vi.stubEnv('SHIPFOX_POLL_MAX_DURATION_MS', '-1');
    vi.resetModules();

    const configImport = import('#config.js');

    await expect(configImport).rejects.toThrow('SHIPFOX_POLL_MAX_DURATION_MS');
  });

  it('fails startup when SHIPFOX_POLL_INTERVAL_MS is zero', async () => {
    vi.stubEnv('SHIPFOX_POLL_INTERVAL_MS', '0');
    vi.resetModules();

    const configImport = import('#config.js');

    await expect(configImport).rejects.toThrow('SHIPFOX_POLL_INTERVAL_MS');
  });

  it('fails startup when SHIPFOX_POLL_MAX_INTERVAL_MS is below the base interval', async () => {
    vi.stubEnv('SHIPFOX_POLL_INTERVAL_MS', '10');
    vi.stubEnv('SHIPFOX_POLL_MAX_INTERVAL_MS', '9');
    vi.resetModules();

    const configImport = import('#config.js');

    await expect(configImport).rejects.toThrow('SHIPFOX_POLL_MAX_INTERVAL_MS');
  });

  it('accepts the documented poll defaults', async () => {
    vi.stubEnv('SHIPFOX_POLL_INTERVAL_MS', undefined);
    vi.stubEnv('SHIPFOX_POLL_MAX_INTERVAL_MS', undefined);
    vi.stubEnv('SHIPFOX_POLL_MAX_DURATION_MS', undefined);
    vi.stubEnv('SHIPFOX_BOOT_CONSOLE_FD', undefined);
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.SHIPFOX_POLL_INTERVAL_MS).toBe(1000);
    expect(config.SHIPFOX_POLL_MAX_INTERVAL_MS).toBe(5000);
    expect(config.SHIPFOX_POLL_MAX_DURATION_MS).toBe(300_000);
    expect(config.SHIPFOX_BOOT_CONSOLE_FD).toBeUndefined();
  });

  it('accepts the runner image boot console descriptor', async () => {
    vi.stubEnv('SHIPFOX_BOOT_CONSOLE_FD', '3');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.SHIPFOX_BOOT_CONSOLE_FD).toBe(3);
  });
});
