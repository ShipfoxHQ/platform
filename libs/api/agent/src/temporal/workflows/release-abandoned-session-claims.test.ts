import {releaseAbandonedSessionClaims} from './release-abandoned-session-claims.js';

const mocks = vi.hoisted(() => ({
  releaseAbandonedSessionClaimsActivity: vi.fn(),
  sleep: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock('@temporalio/workflow', () => ({
  proxyActivities: () => ({
    releaseAbandonedSessionClaimsActivity: mocks.releaseAbandonedSessionClaimsActivity,
  }),
  sleep: mocks.sleep,
  log: {info: mocks.logInfo},
}));

describe('releaseAbandonedSessionClaims', () => {
  beforeEach(() => {
    mocks.sleep.mockReset();
    mocks.releaseAbandonedSessionClaimsActivity.mockReset();
    mocks.logInfo.mockReset();
    mocks.sleep.mockImplementation(async () => undefined);
    mocks.releaseAbandonedSessionClaimsActivity.mockResolvedValue({released: 0});
  });

  it('waits out the grace period before releasing the job step attempt claims', async () => {
    const order: string[] = [];
    mocks.sleep.mockImplementation(() => {
      order.push('sleep');
    });
    mocks.releaseAbandonedSessionClaimsActivity.mockImplementation(() => {
      order.push('activity');
      return {released: 2};
    });

    await releaseAbandonedSessionClaims({jobId: 'job-1', graceSeconds: 120});

    expect(mocks.sleep).toHaveBeenCalledWith(120 * 1000);
    expect(mocks.releaseAbandonedSessionClaimsActivity).toHaveBeenCalledWith({jobId: 'job-1'});
    expect(order).toEqual(['sleep', 'activity']);
  });

  it('logs when the sweep released claims', async () => {
    mocks.releaseAbandonedSessionClaimsActivity.mockResolvedValue({released: 3});

    await releaseAbandonedSessionClaims({jobId: 'job-1', graceSeconds: 30});

    expect(mocks.logInfo).toHaveBeenCalledWith('Released abandoned agent session claims', {
      jobId: 'job-1',
      released: 3,
    });
  });

  it('stays silent when there was nothing to release', async () => {
    await releaseAbandonedSessionClaims({jobId: 'job-1', graceSeconds: 30});

    expect(mocks.logInfo).not.toHaveBeenCalled();
  });
});
