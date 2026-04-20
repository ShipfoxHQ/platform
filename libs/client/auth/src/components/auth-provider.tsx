import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {Provider as JotaiProvider, useAtomValue, useStore} from 'jotai';
import {type PropsWithChildren, useEffect, useState} from 'react';
import {getAuthRefreshDelayMs, useRefreshAuth} from '#hooks/api/refresh-auth.js';
import {authStateAtom} from '#state/auth.js';

const REFRESH_RETRY_DELAY_MS = 60_000;

export function AuthProvider({children}: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <AuthProviderContent>{children}</AuthProviderContent>
      </JotaiProvider>
    </QueryClientProvider>
  );
}

function AuthProviderContent({children}: PropsWithChildren) {
  const store = useStore();
  const authState = useAtomValue(authStateAtom);
  const refreshAuth = useRefreshAuth();

  useEffect(() => {
    configureApiClient({
      getAccessToken: () => store.get(authStateAtom).token,
      refreshAccessToken: async () => {
        const result = await refreshAuth();
        return result.token;
      },
    });
  }, [refreshAuth, store]);

  useEffect(() => {
    refreshAuth().catch(() => {
      // Refresh handles auth state changes for expected auth failures.
    });
  }, [refreshAuth]);

  useEffect(() => {
    if (authState.status !== 'authenticated' || !authState.token) return;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let refreshing = false;

    const clearRefreshTimer = () => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
        timeout = undefined;
      }
    };

    const scheduleRefresh = (delayMs: number) => {
      clearRefreshTimer();
      timeout = setTimeout(runRefresh, Math.max(0, delayMs));
    };

    const retryIfStillDue = () => {
      const current = store.get(authStateAtom);
      if (current.status !== 'authenticated' || !current.token) return;

      const delay = getAuthRefreshDelayMs(current.token);
      if (delay !== undefined && delay <= 0) {
        scheduleRefresh(REFRESH_RETRY_DELAY_MS);
      }
    };

    function runRefresh() {
      if (disposed || refreshing) return;
      refreshing = true;
      clearRefreshTimer();
      refreshAuth()
        .catch(() => {
          // 401s move auth state to guest. Other failures should retry later.
        })
        .finally(() => {
          refreshing = false;
          if (!disposed) retryIfStillDue();
        });
    }

    const refreshIfDue = () => {
      const current = store.get(authStateAtom);
      if (current.status !== 'authenticated' || !current.token) return;

      const delay = getAuthRefreshDelayMs(current.token);
      if (delay !== undefined && delay <= 0) {
        runRefresh();
      }
    };

    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshIfDue();
      }
    };

    const delay = getAuthRefreshDelayMs(authState.token);
    if (delay !== undefined) {
      scheduleRefresh(delay);
    }

    window.addEventListener('focus', refreshIfDue);
    window.addEventListener('online', refreshIfDue);
    document.addEventListener('visibilitychange', refreshIfVisible);

    return () => {
      disposed = true;
      clearRefreshTimer();
      window.removeEventListener('focus', refreshIfDue);
      window.removeEventListener('online', refreshIfDue);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [authState.status, authState.token, refreshAuth, store]);

  return children;
}
