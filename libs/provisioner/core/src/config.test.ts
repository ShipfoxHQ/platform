// Import #config.js inside each test so env validation reruns after vi.stubEnv.

describe('provisioner core config validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('rejects a negative poll wait', async () => {
    vi.stubEnv('SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS', '-1');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS');
  });

  it('rejects a fractional poll wait (the API field is an integer)', async () => {
    vi.stubEnv('SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS', '0.5');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS');
  });

  it('rejects a zero poll interval', async () => {
    vi.stubEnv('SHIPFOX_PROVISIONER_POLL_INTERVAL_MS', '0');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('SHIPFOX_PROVISIONER_POLL_INTERVAL_MS');
  });

  it('rejects a max interval below the base interval', async () => {
    vi.stubEnv('SHIPFOX_PROVISIONER_POLL_INTERVAL_MS', '2000');
    vi.stubEnv('SHIPFOX_PROVISIONER_POLL_MAX_INTERVAL_MS', '1000');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('SHIPFOX_PROVISIONER_POLL_MAX_INTERVAL_MS');
  });

  it('rejects a zero converge interval', async () => {
    vi.stubEnv('SHIPFOX_PROVISIONER_CONVERGE_INTERVAL_MS', '0');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('SHIPFOX_PROVISIONER_CONVERGE_INTERVAL_MS');
  });

  it('rejects max reservations above the API cap', async () => {
    vi.stubEnv('SHIPFOX_PROVISIONER_MAX_RESERVATIONS', '1001');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('SHIPFOX_PROVISIONER_MAX_RESERVATIONS');
  });

  it('rejects a fractional max reservations', async () => {
    vi.stubEnv('SHIPFOX_PROVISIONER_MAX_RESERVATIONS', '10.5');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('SHIPFOX_PROVISIONER_MAX_RESERVATIONS');
  });

  it('rejects a zero runner-instance batch size', async () => {
    vi.stubEnv('SHIPFOX_PROVISIONER_RUNNER_INSTANCE_BATCH_SIZE', '0');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'SHIPFOX_PROVISIONER_RUNNER_INSTANCE_BATCH_SIZE',
    );
  });

  it('rejects a fractional batch size', async () => {
    vi.stubEnv('SHIPFOX_PROVISIONER_RUNNER_INSTANCE_BATCH_SIZE', '12.5');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'SHIPFOX_PROVISIONER_RUNNER_INSTANCE_BATCH_SIZE',
    );
  });

  it('rejects a negative runner poll duration', async () => {
    vi.stubEnv('SHIPFOX_RUNNER_POLL_MAX_DURATION_MS', '-1');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('SHIPFOX_RUNNER_POLL_MAX_DURATION_MS');
  });

  it('rejects a non-positive runner maximum lifetime', async () => {
    vi.stubEnv('SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS', '0');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS');
  });

  it('accepts the documented defaults', async () => {
    vi.stubEnv('SHIPFOX_API_URL', undefined);
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.SHIPFOX_API_URL).toBe('https://api.shipfox.io');
    expect(config.SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS).toBe(30);
    expect(config.SHIPFOX_PROVISIONER_CONVERGE_INTERVAL_MS).toBe(1000);
    expect(config.SHIPFOX_PROVISIONER_MAX_RESERVATIONS).toBe(250);
    expect(config.SHIPFOX_PROVISIONER_RUNNER_INSTANCE_BATCH_SIZE).toBe(250);
    expect(config.SHIPFOX_RUNNER_POLL_MAX_DURATION_MS).toBe(300_000);
    expect(config.SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS).toBe(3600);
  });
});
