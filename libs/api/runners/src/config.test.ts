import {RUNNER_ASSIGNMENT_POLL_DEFAULT_WAIT_SECONDS} from '@shipfox/api-runners-dto';
import {vi} from '@shipfox/vitest/vi';

const staleSessionThresholdThrottleError =
  /RUNNER_STALE_SESSION_THRESHOLD_SECONDS.*RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS/;

describe('RUNNER_RESERVED_LABELS', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to no reserved labels', async () => {
    vi.stubEnv('RUNNER_RESERVED_LABELS', undefined);
    vi.resetModules();

    const {config, runnerReservedLabels} = await import('#config.js');

    expect(config.RUNNER_RESERVED_LABELS).toBe('');
    expect(runnerReservedLabels).toEqual([]);
  });

  it('parses comma-separated labels for case-insensitive matching', async () => {
    vi.stubEnv('RUNNER_RESERVED_LABELS', ' ShipFox-Managed, Linux,shipfox-managed ');
    vi.resetModules();

    const {config, runnerReservedLabels} = await import('#config.js');

    expect(config.RUNNER_RESERVED_LABELS).toBe(' ShipFox-Managed, Linux,shipfox-managed ');
    expect(runnerReservedLabels).toEqual(['linux', 'shipfox-managed']);
  });

  it('rejects invalid runner labels', async () => {
    vi.stubEnv('RUNNER_RESERVED_LABELS', 'linux,has space');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'RUNNER_RESERVED_LABELS contains invalid runner label(s): has space',
    );
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

  it('rejects a zero-second server-side assignment wait cap', async () => {
    vi.stubEnv('RUNNER_ASSIGNMENT_POLL_MAX_WAIT_SECONDS', '0');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('RUNNER_ASSIGNMENT_POLL_MAX_WAIT_SECONDS');
  });
});

describe('RUNNER_DEMAND_ACTIVATION_TIMEOUT_SECONDS validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to a five-minute recovery window', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RUNNER_DEMAND_ACTIVATION_TIMEOUT_SECONDS).toBe(300);
  });

  it.each(['0', '-5', '1.5'])('fails startup when the value is %s', async (value) => {
    vi.stubEnv('RUNNER_DEMAND_ACTIVATION_TIMEOUT_SECONDS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('RUNNER_DEMAND_ACTIVATION_TIMEOUT_SECONDS');
  });
});

describe('reservation TTL ceiling validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '0',
    '-5',
    '1.5',
    '3601',
  ])('fails startup when RESERVATION_TTL_MAX_SECONDS is %s', async (value) => {
    vi.stubEnv('RESERVATION_TTL_MAX_SECONDS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('RESERVATION_TTL_MAX_SECONDS');
  });

  it('defaults high enough for provider registration deadlines and launch headroom', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RESERVATION_TTL_MAX_SECONDS).toBe(600);
  });

  it('accepts a whole-second ceiling inside the hard maximum', async () => {
    vi.stubEnv('RESERVATION_TTL_MAX_SECONDS', '600');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RESERVATION_TTL_MAX_SECONDS).toBe(600);
  });

  it('fails startup when the default reservation TTL is above the ceiling', async () => {
    vi.stubEnv('RESERVATION_TTL_SECONDS', '600');
    vi.stubEnv('RESERVATION_TTL_MAX_SECONDS', '300');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('RESERVATION_TTL_SECONDS');
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

describe('RUNNER_JOB_CLEANUP_GRACE_SECONDS validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '0',
    '-5',
    '1.5',
    '300',
  ])('fails startup when RUNNER_JOB_CLEANUP_GRACE_SECONDS is %s', async (value) => {
    vi.stubEnv('RUNNER_JOB_CLEANUP_GRACE_SECONDS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('RUNNER_JOB_CLEANUP_GRACE_SECONDS');
  });

  it('defaults to a two-minute cleanup grace', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RUNNER_JOB_CLEANUP_GRACE_SECONDS).toBe(120);
  });
});

describe('RUNNER_POST_JOB_EXIT_GRACE_SECONDS validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '0',
    '-5',
    '1.5',
  ])('fails startup when RUNNER_POST_JOB_EXIT_GRACE_SECONDS is %s', async (value) => {
    vi.stubEnv('RUNNER_POST_JOB_EXIT_GRACE_SECONDS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('RUNNER_POST_JOB_EXIT_GRACE_SECONDS');
  });

  it('accepts a positive whole-second grace', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RUNNER_POST_JOB_EXIT_GRACE_SECONDS).toBe(30);
  });
});

describe('termination reason defaults', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('enables job-timeout termination authorization by default', async () => {
    vi.stubEnv('RUNNER_TERMINATION_REASON_JOB_TIMEOUT_ENABLED', undefined);
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RUNNER_TERMINATION_REASON_JOB_TIMEOUT_ENABLED).toBe(true);
  });
});

describe('RUNNER_STALE_SESSION_THRESHOLD_SECONDS validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '0',
    '-5',
    '1.5',
  ])('fails startup when RUNNER_STALE_SESSION_THRESHOLD_SECONDS is %s', async (value) => {
    vi.stubEnv('RUNNER_STALE_SESSION_THRESHOLD_SECONDS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('RUNNER_STALE_SESSION_THRESHOLD_SECONDS');
  });

  it('accepts a positive whole-second threshold', async () => {
    vi.stubEnv('RUNNER_STALE_SESSION_THRESHOLD_SECONDS', '600');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RUNNER_STALE_SESSION_THRESHOLD_SECONDS).toBe(600);
    expect(config.RUNNER_STALE_IDLE_SESSION_RECOVERY_LIMIT).toBe(100);
  });

  it.each([
    ['RUNNER_STALE_IDLE_SESSION_RECOVERY_LIMIT', '0'],
    ['RUNNER_STALE_IDLE_SESSION_RECOVERY_LIMIT', '-5'],
    ['RUNNER_STALE_IDLE_SESSION_RECOVERY_LIMIT', '1.5'],
  ])('fails startup when %s is %s', async (name, value) => {
    vi.stubEnv(name, value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(name);
  });

  it('fails startup when the stale-session threshold does not exceed the liveness throttle', async () => {
    vi.stubEnv('RUNNER_STALE_SESSION_THRESHOLD_SECONDS', '300');
    vi.stubEnv('RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS', '700');
    vi.stubEnv('RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS', '600');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(staleSessionThresholdThrottleError);
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
