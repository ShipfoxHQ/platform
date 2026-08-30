import type {JiraInstallation} from '#db/installations.js';
import {JIRA_REFRESH_TOKEN_PROACTIVE_REFRESH_AFTER_MS} from '#temporal/constants.js';
import {createJiraMaintenanceActivities} from './index.js';

function installation(connectionId: string): JiraInstallation {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: crypto.randomUUID(),
    connectionId,
    cloudId: crypto.randomUUID(),
    siteUrl: 'https://acme.atlassian.net',
    siteName: 'Acme',
    authorizingAccountId: crypto.randomUUID(),
    scopes: ['offline_access'],
    webhookIds: [],
    webhookExpiresAt: null,
    status: 'installed',
    tokenExpiresAt: now,
    refreshTokenLastUsedAt: now,
    refreshTokenLastAttemptedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

describe('Jira proactive token refresh activity', () => {
  it('force-refreshes due active connections and skips inactive ones', async () => {
    const activeConnectionId = crypto.randomUUID();
    const inactiveConnectionId = crypto.randomUUID();
    const failedConnectionId = crypto.randomUUID();
    const installations = [
      installation(activeConnectionId),
      installation(inactiveConnectionId),
      installation(failedConnectionId),
    ];
    const listInstallations = vi.fn().mockResolvedValue(installations);
    const resolveConnection = vi.fn().mockImplementation((connectionId: string) => {
      if (connectionId === activeConnectionId || connectionId === failedConnectionId) {
        return Promise.resolve({lifecycleStatus: 'active'});
      }
      return Promise.resolve({lifecycleStatus: 'error'});
    });
    const getAccessToken = vi.fn().mockImplementation(({connectionId}: {connectionId: string}) => {
      if (connectionId === failedConnectionId) throw new Error('refresh failed');
      return 'fresh-access-token';
    });
    const heartbeat = vi.fn();
    const markAttempted = vi.fn().mockResolvedValue(undefined);
    const now = new Date('2026-08-04T00:00:00.000Z');
    const activities = createJiraMaintenanceActivities({
      tokenStore: {getAccessToken},
      resolveConnection,
      listInstallations,
      markAttempted,
      now: () => now,
      heartbeat,
    });

    const result = await activities.refreshJiraTokensActivity();

    expect(listInstallations).toHaveBeenCalledWith({
      before: new Date(now.getTime() - JIRA_REFRESH_TOKEN_PROACTIVE_REFRESH_AFTER_MS),
      limit: 20,
    });
    expect(getAccessToken).toHaveBeenCalledWith({
      connectionId: activeConnectionId,
      forceRefresh: true,
    });
    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(heartbeat).toHaveBeenCalledTimes(6);
    expect(markAttempted).toHaveBeenCalledTimes(3);
    expect(result).toEqual({refreshed: 1, skipped: 1, failed: 1});
  });

  it('heartbeats while a token refresh is in flight', async () => {
    vi.useFakeTimers();
    try {
      const connectionId = crypto.randomUUID();
      let resolveToken!: (value: string | PromiseLike<string>) => void;
      const getAccessToken = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveToken = resolve;
          }),
      );
      const heartbeat = vi.fn();
      const activities = createJiraMaintenanceActivities({
        tokenStore: {getAccessToken},
        resolveConnection: vi.fn().mockResolvedValue({lifecycleStatus: 'active'}),
        listInstallations: vi.fn().mockResolvedValue([installation(connectionId)]),
        markAttempted: vi.fn().mockResolvedValue(undefined),
        heartbeat,
      });

      const result = activities.refreshJiraTokensActivity();
      await vi.waitFor(() => expect(getAccessToken).toHaveBeenCalledOnce());
      const heartbeatCountBeforeRefresh = heartbeat.mock.calls.length;

      await vi.advanceTimersByTimeAsync(30_000);

      expect(heartbeat.mock.calls.length).toBeGreaterThan(heartbeatCountBeforeRefresh);
      resolveToken('fresh-access-token');
      await expect(result).resolves.toEqual({refreshed: 1, skipped: 0, failed: 0});
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts an attempt failure and continues with the next installation', async () => {
    const failedConnectionId = crypto.randomUUID();
    const activeConnectionId = crypto.randomUUID();
    const installations = [installation(failedConnectionId), installation(activeConnectionId)];
    const activities = createJiraMaintenanceActivities({
      tokenStore: {getAccessToken: vi.fn().mockResolvedValue('fresh-access-token')},
      resolveConnection: vi.fn().mockResolvedValue({lifecycleStatus: 'active'}),
      listInstallations: vi.fn().mockResolvedValue(installations),
      markAttempted: vi
        .fn()
        .mockRejectedValueOnce(new Error('attempt write failed'))
        .mockResolvedValue(undefined),
      heartbeat: vi.fn(),
    });

    const result = await activities.refreshJiraTokensActivity();

    expect(result).toEqual({refreshed: 1, skipped: 0, failed: 1});
  });

  it('counts a connection lookup failure and continues with the next installation', async () => {
    const failedConnectionId = crypto.randomUUID();
    const activeConnectionId = crypto.randomUUID();
    const getAccessToken = vi.fn().mockResolvedValue('fresh-access-token');
    const activities = createJiraMaintenanceActivities({
      tokenStore: {getAccessToken},
      resolveConnection: vi
        .fn()
        .mockRejectedValueOnce(new Error('connection lookup failed'))
        .mockResolvedValue({lifecycleStatus: 'active'}),
      listInstallations: vi
        .fn()
        .mockResolvedValue([installation(failedConnectionId), installation(activeConnectionId)]),
      markAttempted: vi.fn().mockResolvedValue(undefined),
    });

    const result = await activities.refreshJiraTokensActivity();

    expect(getAccessToken).toHaveBeenCalledWith({
      connectionId: activeConnectionId,
      forceRefresh: true,
    });
    expect(result).toEqual({refreshed: 1, skipped: 0, failed: 1});
  });
});
