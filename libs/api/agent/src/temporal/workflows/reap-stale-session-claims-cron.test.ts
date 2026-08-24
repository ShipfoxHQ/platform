import {reapStaleSessionClaimsCron} from './reap-stale-session-claims-cron.js';

const mocks = vi.hoisted(() => ({
  reapStaleSessionClaimsActivity: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock('@temporalio/workflow', () => ({
  proxyActivities: () => ({
    reapStaleSessionClaimsActivity: mocks.reapStaleSessionClaimsActivity,
  }),
  log: {info: mocks.logInfo},
}));

describe('reapStaleSessionClaimsCron', () => {
  beforeEach(() => {
    mocks.reapStaleSessionClaimsActivity.mockReset();
    mocks.logInfo.mockReset();
    mocks.reapStaleSessionClaimsActivity.mockResolvedValue({reaped: 0, failed: 0});
  });

  it('logs when the tick reaped stale claims', async () => {
    mocks.reapStaleSessionClaimsActivity.mockResolvedValue({reaped: 2, failed: 0});

    await reapStaleSessionClaimsCron();

    expect(mocks.logInfo).toHaveBeenCalledWith('Reaped stale agent session claims', {
      reaped: 2,
      failed: 0,
    });
  });

  it('logs when a release in the batch failed', async () => {
    mocks.reapStaleSessionClaimsActivity.mockResolvedValue({reaped: 0, failed: 1});

    await reapStaleSessionClaimsCron();

    expect(mocks.logInfo).toHaveBeenCalledWith('Reaped stale agent session claims', {
      reaped: 0,
      failed: 1,
    });
  });

  it('stays silent on a clean no-op tick', async () => {
    await reapStaleSessionClaimsCron();

    expect(mocks.logInfo).not.toHaveBeenCalled();
  });
});
