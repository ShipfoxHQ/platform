vi.mock('#core/maintenance.js', () => ({
  deleteExpiredEphemeralRegistrationTokens: vi.fn(),
  deleteExpiredRunnerReservations: vi.fn(),
  deleteExpiredRunnerSessions: vi.fn(),
  detectAndExpireStuckJobs: vi.fn(),
  reapStaleRunnerInstances: vi.fn(),
}));

let maintenance: typeof import('#core/maintenance.js');
let activities: typeof import('./maintenance-activities.js');

beforeEach(async () => {
  vi.resetModules();
  maintenance = await import('#core/maintenance.js');
  activities = await import('./maintenance-activities.js');
  vi.clearAllMocks();
});

describe('detectAndExpireStuckJobsActivity', () => {
  it('delegates to core maintenance', async () => {
    vi.mocked(maintenance.detectAndExpireStuckJobs).mockResolvedValueOnce({expired: 2});

    const result = await activities.detectAndExpireStuckJobsActivity({thresholdSeconds: 180});

    expect(result).toEqual({expired: 2});
    expect(maintenance.detectAndExpireStuckJobs).toHaveBeenCalledWith({thresholdSeconds: 180});
  });
});

describe('deleteExpiredReservationsActivity', () => {
  it('delegates to core maintenance', async () => {
    vi.mocked(maintenance.deleteExpiredRunnerReservations).mockResolvedValueOnce({deleted: 3});

    const result = await activities.deleteExpiredReservationsActivity({limit: 50});

    expect(result).toEqual({deleted: 3});
    expect(maintenance.deleteExpiredRunnerReservations).toHaveBeenCalledWith({limit: 50});
  });
});

describe('reapStaleRunnerInstancesActivity', () => {
  it('delegates to core maintenance', async () => {
    vi.mocked(maintenance.reapStaleRunnerInstances).mockResolvedValueOnce({
      reaped: 4,
      reservationsReleased: 2,
    });

    const result = await activities.reapStaleRunnerInstancesActivity({
      thresholdSeconds: 300,
      limit: 100,
    });

    expect(result).toEqual({reaped: 4, reservationsReleased: 2});
    expect(maintenance.reapStaleRunnerInstances).toHaveBeenCalledWith({
      thresholdSeconds: 300,
      limit: 100,
    });
  });
});

describe('deleteExpiredRunnerSessionsActivity', () => {
  it('delegates to core maintenance', async () => {
    vi.mocked(maintenance.deleteExpiredRunnerSessions).mockResolvedValueOnce({deleted: 4});

    const result = await activities.deleteExpiredRunnerSessionsActivity({
      manualRetentionDays: 30,
      ephemeralRetentionDays: 7,
      limit: 25,
    });

    expect(result).toEqual({deleted: 4});
    expect(maintenance.deleteExpiredRunnerSessions).toHaveBeenCalledWith({
      manualRetentionDays: 30,
      ephemeralRetentionDays: 7,
      limit: 25,
    });
  });
});

describe('deleteExpiredEphemeralRegistrationTokensActivity', () => {
  it('delegates to core maintenance', async () => {
    vi.mocked(maintenance.deleteExpiredEphemeralRegistrationTokens).mockResolvedValueOnce({
      deleted: 6,
    });

    const result = await activities.deleteExpiredEphemeralRegistrationTokensActivity({
      retentionDays: 7,
      limit: 25,
    });

    expect(result).toEqual({deleted: 6});
    expect(maintenance.deleteExpiredEphemeralRegistrationTokens).toHaveBeenCalledWith({
      retentionDays: 7,
      limit: 25,
    });
  });
});
