describe('LOG_RETENTION_DAYS validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(['0', '-5', '1.5'])('fails startup when LOG_RETENTION_DAYS is %s', async (value) => {
    vi.stubEnv('LOG_RETENTION_DAYS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('LOG_RETENTION_DAYS');
  });

  it('accepts a whole-day value of 1 or greater', async () => {
    vi.stubEnv('LOG_RETENTION_DAYS', '30');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.LOG_RETENTION_DAYS).toBe(30);
  });
});

describe('LOG_STREAM_REAP_AFTER_SECONDS validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    0, -100, 5400,
  ])('rejects a reaper window of %d seconds for a 90-minute Auth lease', async (value) => {
    vi.stubEnv('LOG_STREAM_REAP_AFTER_SECONDS', String(value));
    vi.resetModules();

    const {validateLogStreamReapAfterSeconds} = await import('#config.js');

    expect(() => validateLogStreamReapAfterSeconds(5400)).toThrow('LOG_STREAM_REAP_AFTER_SECONDS');
  });

  it('accepts a reaper window above the Auth lease lifetime', async () => {
    vi.stubEnv('LOG_STREAM_REAP_AFTER_SECONDS', '600');
    vi.resetModules();

    const {validateLogStreamReapAfterSeconds} = await import('#config.js');

    expect(() => validateLogStreamReapAfterSeconds(300)).not.toThrow();
  });
});

describe('LOG_MAX_SESSION_LINE_BYTES validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('fails startup when the session line cap exceeds the append body limit', async () => {
    vi.stubEnv('LOG_APPEND_BODY_LIMIT_BYTES', '1024');
    vi.stubEnv('LOG_MAX_SESSION_LINE_BYTES', '2048');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('LOG_APPEND_BODY_LIMIT_BYTES');
  });

  it('accepts a session line cap equal to the append body limit', async () => {
    vi.stubEnv('LOG_APPEND_BODY_LIMIT_BYTES', '2048');
    vi.stubEnv('LOG_MAX_SESSION_LINE_BYTES', '2048');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.LOG_MAX_SESSION_LINE_BYTES).toBe(2048);
  });
});
