const mocks = vi.hoisted(() => ({
  deleteExpiredEphemeralRegistrationTokensActivity: vi.fn(),
  deleteExpiredReservationsActivity: vi.fn(),
  deleteExpiredRunnerSessionsActivity: vi.fn(),
  detectAndExpireStuckJobsActivity: vi.fn(),
  reapStaleRunnerInstancesActivity: vi.fn(),
  recoverStaleIdleRunnerSessionsActivity: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@temporalio/workflow', () => ({
  log: {
    info: mocks.info,
    warn: mocks.warn,
  },
  proxyActivities: vi.fn(() => ({
    deleteExpiredEphemeralRegistrationTokensActivity:
      mocks.deleteExpiredEphemeralRegistrationTokensActivity,
    deleteExpiredReservationsActivity: mocks.deleteExpiredReservationsActivity,
    deleteExpiredRunnerSessionsActivity: mocks.deleteExpiredRunnerSessionsActivity,
    detectAndExpireStuckJobsActivity: mocks.detectAndExpireStuckJobsActivity,
    reapStaleRunnerInstancesActivity: mocks.reapStaleRunnerInstancesActivity,
    recoverStaleIdleRunnerSessionsActivity: mocks.recoverStaleIdleRunnerSessionsActivity,
  })),
}));

describe('stuckJobDetector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteExpiredEphemeralRegistrationTokensActivity.mockResolvedValue({deleted: 0});
    mocks.deleteExpiredReservationsActivity.mockResolvedValue({deleted: 0});
    mocks.deleteExpiredRunnerSessionsActivity.mockResolvedValue({deleted: 0});
    mocks.detectAndExpireStuckJobsActivity.mockResolvedValue({expired: 0});
    mocks.reapStaleRunnerInstancesActivity.mockResolvedValue({
      reaped: 0,
      reservationsReleased: 0,
    });
    mocks.recoverStaleIdleRunnerSessionsActivity.mockResolvedValue({recovered: 0});
  });

  it('recovers stale idle sessions before stale provisioner cleanup and logs recoveries', async () => {
    const {stuckJobDetector} = await import('./stuck-job-detector.js');
    mocks.recoverStaleIdleRunnerSessionsActivity.mockResolvedValueOnce({recovered: 2});

    await stuckJobDetector();

    expect(mocks.recoverStaleIdleRunnerSessionsActivity).toHaveBeenCalledWith();
    expect(mocks.reapStaleRunnerInstancesActivity).toHaveBeenCalledWith();
    expect(mocks.info).toHaveBeenCalledWith(
      'Stuck-job detector recovered stale idle runner sessions',
      {recovered: 2},
    );
  });

  it('runs expired session GC before stuck job expiry and logs deletions', async () => {
    const {stuckJobDetector} = await import('./stuck-job-detector.js');
    mocks.deleteExpiredRunnerSessionsActivity.mockResolvedValueOnce({deleted: 2});

    await stuckJobDetector();

    expect(mocks.deleteExpiredRunnerSessionsActivity).toHaveBeenCalledWith();
    expect(mocks.detectAndExpireStuckJobsActivity).toHaveBeenCalledWith({thresholdSeconds: 180});
    expect(mocks.info).toHaveBeenCalledWith('Stuck-job detector deleted expired runner sessions', {
      deleted: 2,
    });
  });

  it('continues stuck job expiry when expired session GC fails', async () => {
    const {stuckJobDetector} = await import('./stuck-job-detector.js');
    mocks.deleteExpiredRunnerSessionsActivity.mockRejectedValueOnce(new Error('database down'));

    await stuckJobDetector();

    expect(mocks.warn).toHaveBeenCalledWith(
      'Stuck-job detector failed to delete expired runner sessions',
      {error: 'database down'},
    );
    expect(mocks.detectAndExpireStuckJobsActivity).toHaveBeenCalledWith({thresholdSeconds: 180});
  });

  it('runs expired ephemeral token GC before stuck job expiry and logs deletions', async () => {
    const {stuckJobDetector} = await import('./stuck-job-detector.js');
    mocks.deleteExpiredEphemeralRegistrationTokensActivity.mockResolvedValueOnce({deleted: 3});

    await stuckJobDetector();

    expect(mocks.deleteExpiredEphemeralRegistrationTokensActivity).toHaveBeenCalledWith();
    expect(mocks.detectAndExpireStuckJobsActivity).toHaveBeenCalledWith({thresholdSeconds: 180});
    expect(mocks.info).toHaveBeenCalledWith(
      'Stuck-job detector deleted expired ephemeral registration tokens',
      {deleted: 3},
    );
  });

  it('continues stuck job expiry when expired ephemeral token GC fails', async () => {
    const {stuckJobDetector} = await import('./stuck-job-detector.js');
    mocks.deleteExpiredEphemeralRegistrationTokensActivity.mockRejectedValueOnce(
      new Error('database down'),
    );

    await stuckJobDetector();

    expect(mocks.warn).toHaveBeenCalledWith(
      'Stuck-job detector failed to delete expired ephemeral registration tokens',
      {error: 'database down'},
    );
    expect(mocks.detectAndExpireStuckJobsActivity).toHaveBeenCalledWith({thresholdSeconds: 180});
  });
});
