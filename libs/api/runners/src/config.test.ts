import {RUNNER_ASSIGNMENT_POLL_DEFAULT_WAIT_SECONDS} from '@shipfox/api-runners-dto';
import {vi} from '@shipfox/vitest/vi';

describe('EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '0',
    '-5',
    '1.5',
    '3601',
  ])('fails startup when EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS is %s', async (value) => {
    vi.stubEnv('EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS');
  });

  it('accepts a whole-second value inside the hard ceiling', async () => {
    vi.stubEnv('EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS', '3600');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS).toBe(3600);
  });
});
describe('runner assignment polling defaults', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it('uses a 250 millisecond interval between assignment reads', async () => {
    vi.resetModules();
    const {config} = await import('#config.js');
    expect(config.RUNNER_ASSIGNMENT_POLL_INTERVAL_MS).toBe(250);
    expect(config.RUNNER_ASSIGNMENT_POLL_MAX_WAIT_SECONDS).toBe(
      RUNNER_ASSIGNMENT_POLL_DEFAULT_WAIT_SECONDS,
    );
  });
});
describe('REGISTRATION_TOKEN_BATCH_MAX validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '0',
    '-5',
    '1.5',
    '1001',
  ])('fails startup when REGISTRATION_TOKEN_BATCH_MAX is %s', async (value) => {
    vi.stubEnv('REGISTRATION_TOKEN_BATCH_MAX', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('REGISTRATION_TOKEN_BATCH_MAX');
  });

  it('accepts a whole-number value inside the DTO hard ceiling', async () => {
    vi.stubEnv('REGISTRATION_TOKEN_BATCH_MAX', '1000');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.REGISTRATION_TOKEN_BATCH_MAX).toBe(1000);
  });
});

describe.each([
  'PROVISIONER_MINT_RATE_LIMIT_MAX_REQUESTS',
  'PROVISIONER_MINT_RATE_LIMIT_WINDOW_SECONDS',
  'EPHEMERAL_REGISTER_RATE_LIMIT_MAX_REQUESTS',
  'EPHEMERAL_REGISTER_RATE_LIMIT_WINDOW_SECONDS',
  'RUNNERS_RATE_LIMIT_TIMEOUT_MS',
] as const)('%s validation', (name) => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(['0', '-5', '1.5'])('fails startup when the value is %s', async (value) => {
    vi.stubEnv(name, value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(name);
  });

  it('accepts a whole number >= 1', async () => {
    vi.stubEnv(name, '1');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config[name]).toBe(1);
  });
});

describe('RUNNER_NO_FIRST_HEARTBEAT_GRACE_SECONDS validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '0',
    '-5',
    '1.5',
    '180',
  ])('fails startup when RUNNER_NO_FIRST_HEARTBEAT_GRACE_SECONDS is %s', async (value) => {
    vi.stubEnv('RUNNER_NO_FIRST_HEARTBEAT_GRACE_SECONDS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('RUNNER_NO_FIRST_HEARTBEAT_GRACE_SECONDS');
  });

  it('accepts the default 60 second grace', async () => {
    vi.stubEnv('RUNNER_NO_FIRST_HEARTBEAT_GRACE_SECONDS', '60');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RUNNER_NO_FIRST_HEARTBEAT_GRACE_SECONDS).toBe(60);
  });
});

describe('RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '0',
    '-5',
    '1.5',
  ])('fails startup when RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS is %s', async (value) => {
    vi.stubEnv('RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS',
    );
  });

  it('accepts a positive whole-second threshold', async () => {
    vi.stubEnv('RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS', '600');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS).toBe(600);
  });
});

describe('RUNNER_TOOL_CAPABILITIES_STALE_AFTER_SECONDS validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '0',
    '-5',
    '1.5',
  ])('fails startup when RUNNER_TOOL_CAPABILITIES_STALE_AFTER_SECONDS is %s', async (value) => {
    vi.stubEnv('RUNNER_TOOL_CAPABILITIES_STALE_AFTER_SECONDS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'RUNNER_TOOL_CAPABILITIES_STALE_AFTER_SECONDS',
    );
  });

  it('accepts the default 60 second stale window', async () => {
    vi.stubEnv('RUNNER_TOOL_CAPABILITIES_STALE_AFTER_SECONDS', '60');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RUNNER_TOOL_CAPABILITIES_STALE_AFTER_SECONDS).toBe(60);
  });
});

describe('RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '0',
    '-5',
    '1.5',
  ])('fails startup when RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT is %s', async (value) => {
    vi.stubEnv('RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT',
    );
  });

  it('accepts a positive whole-number limit', async () => {
    vi.stubEnv('RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT', '250');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT).toBe(250);
  });
});

describe('RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '0',
    '-5',
    '1.5',
  ])('fails startup when RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS is %s', async (value) => {
    vi.stubEnv('RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS');
  });

  it('accepts a positive whole-second throttle', async () => {
    vi.stubEnv('RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS', '30');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS).toBe(30);
  });
});

describe('stale provisioned runner threshold validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    ['300', '300'],
    ['299', '300'],
  ])('fails startup when RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS=%s and PROVISIONER_LAST_SEEN_THROTTLE_SECONDS=%s', async (thresholdSeconds, throttleSeconds) => {
    vi.stubEnv('RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS', thresholdSeconds);
    vi.stubEnv('PROVISIONER_LAST_SEEN_THROTTLE_SECONDS', throttleSeconds);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS',
    );
  });

  it.each([
    ['300', '300'],
    ['299', '300'],
  ])('fails startup when RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS=%s and RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS=%s', async (thresholdSeconds, throttleSeconds) => {
    vi.stubEnv('RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS', thresholdSeconds);
    vi.stubEnv('RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS', throttleSeconds);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS',
    );
  });
});

describe('PROVISIONED_RUNNER_COUNT_DIVERGENCE_TEMPLATE_KEY_LABEL_ENABLED', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to disabling template_key on the divergence metric', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.PROVISIONED_RUNNER_COUNT_DIVERGENCE_TEMPLATE_KEY_LABEL_ENABLED).toBe(false);
  });

  it('can enable template_key on the divergence metric', async () => {
    vi.stubEnv('PROVISIONED_RUNNER_COUNT_DIVERGENCE_TEMPLATE_KEY_LABEL_ENABLED', 'true');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.PROVISIONED_RUNNER_COUNT_DIVERGENCE_TEMPLATE_KEY_LABEL_ENABLED).toBe(true);
  });
});

describe('runner session retention config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses the default retention windows and batch size', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RUNNER_SESSION_MANUAL_RETENTION_DAYS).toBe(30);
    expect(config.RUNNER_SESSION_EPHEMERAL_RETENTION_DAYS).toBe(7);
    expect(config.RUNNER_SESSION_GC_BATCH_SIZE).toBe(1000);
  });

  it.each([
    ['RUNNER_SESSION_MANUAL_RETENTION_DAYS', '0'],
    ['RUNNER_SESSION_MANUAL_RETENTION_DAYS', '-5'],
    ['RUNNER_SESSION_MANUAL_RETENTION_DAYS', '1.5'],
    ['RUNNER_SESSION_EPHEMERAL_RETENTION_DAYS', '0'],
    ['RUNNER_SESSION_EPHEMERAL_RETENTION_DAYS', '-5'],
    ['RUNNER_SESSION_EPHEMERAL_RETENTION_DAYS', '1.5'],
    ['RUNNER_SESSION_GC_BATCH_SIZE', '0'],
    ['RUNNER_SESSION_GC_BATCH_SIZE', '-5'],
    ['RUNNER_SESSION_GC_BATCH_SIZE', '1.5'],
  ])('fails startup when %s is %s', async (name, value) => {
    vi.stubEnv(name, value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(name);
  });
});

describe('ephemeral registration token retention config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses the default retention window and batch size', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RUNNER_EPHEMERAL_TOKEN_RETENTION_DAYS).toBe(7);
    expect(config.RUNNER_EPHEMERAL_TOKEN_GC_BATCH_SIZE).toBe(1000);
  });

  it.each([
    ['RUNNER_EPHEMERAL_TOKEN_RETENTION_DAYS', '0'],
    ['RUNNER_EPHEMERAL_TOKEN_RETENTION_DAYS', '-5'],
    ['RUNNER_EPHEMERAL_TOKEN_RETENTION_DAYS', '1.5'],
    ['RUNNER_EPHEMERAL_TOKEN_GC_BATCH_SIZE', '0'],
    ['RUNNER_EPHEMERAL_TOKEN_GC_BATCH_SIZE', '-5'],
    ['RUNNER_EPHEMERAL_TOKEN_GC_BATCH_SIZE', '1.5'],
  ])('fails startup when %s is %s', async (name, value) => {
    vi.stubEnv(name, value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(name);
  });
});
