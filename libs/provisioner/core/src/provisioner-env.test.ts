describe('buildRunnerEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('includes the runner lifecycle limits in the shared image contract', async () => {
    vi.stubEnv('SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS', '7200');
    vi.stubEnv('SHIPFOX_RUNNER_POLL_MAX_DURATION_MS', '600000');
    vi.resetModules();

    const {buildRunnerEnv} = await import('#provisioner.js');

    const runnerEnv = buildRunnerEnv({
      template: {key: 'small', labels: ['ubuntu24'], maxConcurrency: 1, cost: 1, spec: null},
      bootstrapToken: 'sf_rbt_test',
    });

    expect(runnerEnv).toMatchObject({
      SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS: '7200',
      SHIPFOX_POLL_MAX_DURATION_MS: '600000',
    });
  });
});
