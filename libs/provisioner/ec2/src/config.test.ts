import {requirePositiveInteger} from '#config.js';

describe('requirePositiveInteger', () => {
  it('returns a positive integer', () => {
    const value = requirePositiveInteger('VALUE', 1);

    expect(value).toBe(1);
  });

  it.each([0, -1, 1.5])('rejects %d', (value) => {
    expect(() => requirePositiveInteger('VALUE', value)).toThrow(
      `VALUE must be a positive integer; got ${value}.`,
    );
  });
});

describe('EC2 reservation timing configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses a 30-second launch headroom by default', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.SHIPFOX_PROVISIONER_EC2_LAUNCH_HEADROOM_MS).toBe(30_000);
  });

  it.each(['0', '-1', '1.5'])('rejects an invalid launch headroom: %s', async (value) => {
    vi.stubEnv('SHIPFOX_PROVISIONER_EC2_LAUNCH_HEADROOM_MS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'SHIPFOX_PROVISIONER_EC2_LAUNCH_HEADROOM_MS',
    );
  });
});
