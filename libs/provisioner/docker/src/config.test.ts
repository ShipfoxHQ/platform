describe('Docker provisioner configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses bounded failed-container retention defaults and inherits the daemon driver', async () => {
    const {config, dockerLogDriver, dockerLogOptions} = await import('#config.js');

    expect(config.SHIPFOX_PROVISIONER_DOCKER_FAILED_CONTAINER_RETENTION_MS).toBe(3_600_000);
    expect(config.SHIPFOX_PROVISIONER_DOCKER_MAX_RETAINED_FAILED_CONTAINERS).toBe(20);
    expect(dockerLogDriver).toBeUndefined();
    expect(dockerLogOptions).toBeUndefined();
  });

  it.each(['-1', '1.5'])('rejects invalid retention values: %s', async (value) => {
    vi.stubEnv('SHIPFOX_PROVISIONER_DOCKER_FAILED_CONTAINER_RETENTION_MS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'SHIPFOX_PROVISIONER_DOCKER_FAILED_CONTAINER_RETENTION_MS',
    );
  });

  it('accepts zero to disable retention', async () => {
    vi.stubEnv('SHIPFOX_PROVISIONER_DOCKER_FAILED_CONTAINER_RETENTION_MS', '0');
    vi.stubEnv('SHIPFOX_PROVISIONER_DOCKER_MAX_RETAINED_FAILED_CONTAINERS', '0');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.SHIPFOX_PROVISIONER_DOCKER_FAILED_CONTAINER_RETENTION_MS).toBe(0);
    expect(config.SHIPFOX_PROVISIONER_DOCKER_MAX_RETAINED_FAILED_CONTAINERS).toBe(0);
  });

  it('parses string-valued driver options and exposes no option values to callers that log config', async () => {
    vi.stubEnv('SHIPFOX_PROVISIONER_DOCKER_LOG_DRIVER', 'local');
    vi.stubEnv(
      'SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS',
      JSON.stringify({'max-size': '10m', 'max-file': '5'}),
    );
    vi.resetModules();

    const {dockerLogDriver, dockerLogOptions} = await import('#config.js');

    expect(dockerLogDriver).toBe('local');
    expect(dockerLogOptions).toEqual({'max-size': '10m', 'max-file': '5'});
  });

  it.each([
    'not-json',
    '[]',
    '{"nested":{"value":"secret"}}',
    '{"max-file":5}',
  ])('rejects unsafe Docker logging options: %s', async (value) => {
    vi.stubEnv('SHIPFOX_PROVISIONER_DOCKER_LOG_DRIVER', 'local');
    vi.stubEnv('SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS');
  });

  it('redacts malformed logging-option values from configuration errors', async () => {
    const secret = 'splunk-secret-sentinel';
    vi.stubEnv('SHIPFOX_PROVISIONER_DOCKER_LOG_DRIVER', 'splunk');
    vi.stubEnv('SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS', `{"token":"${secret}`);
    vi.resetModules();

    const result = import('#config.js');
    await expect(result).rejects.toThrow(
      'SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS must be valid JSON; the value was not logged because it may contain credentials.',
    );
    await expect(result).rejects.not.toThrow(secret);
  });

  it('rejects logging options without a logging driver', async () => {
    vi.stubEnv('SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS', '{}');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS requires SHIPFOX_PROVISIONER_DOCKER_LOG_DRIVER',
    );
  });
});
