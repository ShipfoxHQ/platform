import {createGithubCheckoutTokenCacheMaintenanceActivities} from './cleanup-github-checkout-token-cache.js';

describe('createGithubCheckoutTokenCacheMaintenanceActivities', () => {
  it('scans GitHub installations with one bounded deletion budget', async () => {
    const cleanupExpiredInstallation = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const heartbeat = vi.fn();
    const activities = createGithubCheckoutTokenCacheMaintenanceActivities({
      cache: {cleanupExpiredInstallation},
      listConnections: async () => [
        {workspaceId: 'workspace-a', externalAccountId: '11'},
        {workspaceId: 'workspace-b', externalAccountId: '12'},
        {workspaceId: 'workspace-c', externalAccountId: 'not-an-installation'},
      ],
      batchSize: 3,
      heartbeat,
    });

    await expect(activities.cleanupGithubCheckoutTokenCacheActivity()).resolves.toEqual({
      deleted: 3,
      failed: 0,
      scanned: 2,
      skipped: 0,
    });
    expect(cleanupExpiredInstallation).toHaveBeenNthCalledWith(1, 'workspace-a', 11, 3);
    expect(cleanupExpiredInstallation).toHaveBeenNthCalledWith(2, 'workspace-b', 12, 2);
    expect(heartbeat).toHaveBeenCalled();
  });

  it('skips malformed installation identifiers without invoking the cache', async () => {
    const cleanupExpiredInstallation = vi.fn(() => Promise.resolve(0));
    const activities = createGithubCheckoutTokenCacheMaintenanceActivities({
      cache: {cleanupExpiredInstallation},
      listConnections: async () => [
        {workspaceId: 'workspace-a', externalAccountId: '0123'},
        {workspaceId: 'workspace-b', externalAccountId: '0'},
      ],
    });

    await expect(activities.cleanupGithubCheckoutTokenCacheActivity()).resolves.toMatchObject({
      deleted: 0,
      failed: 0,
      scanned: 0,
      skipped: 2,
    });
    expect(cleanupExpiredInstallation).not.toHaveBeenCalled();
  });

  it('continues past more than one batch of clean or malformed connections', async () => {
    const cleanupExpiredInstallation = vi.fn(() => Promise.resolve(0));
    const connections = [
      ...Array.from({length: 100}, (_, index) => ({
        workspaceId: `malformed-${index}`,
        externalAccountId: 'not-an-installation',
      })),
      ...Array.from({length: 101}, (_, index) => ({
        workspaceId: `workspace-${index}`,
        externalAccountId: String(index + 1),
      })),
    ];
    const activities = createGithubCheckoutTokenCacheMaintenanceActivities({
      cache: {cleanupExpiredInstallation},
      listConnections: async () => connections,
      batchSize: 100,
    });

    await expect(activities.cleanupGithubCheckoutTokenCacheActivity()).resolves.toEqual({
      deleted: 0,
      failed: 0,
      scanned: 101,
      skipped: 100,
    });
    expect(cleanupExpiredInstallation).toHaveBeenCalledTimes(101);
  });

  it('heartbeats while an installation cleanup is in flight', async () => {
    vi.useFakeTimers();
    try {
      let resolveCleanup!: (value: number) => void;
      const cleanupExpiredInstallation = vi.fn(
        () => new Promise<number>((resolve) => (resolveCleanup = resolve)),
      );
      const heartbeat = vi.fn();
      const activities = createGithubCheckoutTokenCacheMaintenanceActivities({
        cache: {cleanupExpiredInstallation},
        listConnections: async () => [{workspaceId: 'workspace-a', externalAccountId: '11'}],
        heartbeat,
      });

      const result = activities.cleanupGithubCheckoutTokenCacheActivity();
      await vi.waitFor(() => expect(cleanupExpiredInstallation).toHaveBeenCalledOnce());
      const heartbeatCountBeforeCleanup = heartbeat.mock.calls.length;

      await vi.advanceTimersByTimeAsync(30_000);

      expect(heartbeat.mock.calls.length).toBeGreaterThan(heartbeatCountBeforeCleanup);
      resolveCleanup(0);
      await expect(result).resolves.toEqual({deleted: 0, failed: 0, scanned: 1, skipped: 0});
    } finally {
      vi.useRealTimers();
    }
  });
});
