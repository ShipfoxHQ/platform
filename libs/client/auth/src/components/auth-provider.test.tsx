import {ApiError, configureApiClient} from '@shipfox/client-api';
import {QueryClient, useQuery, useQueryClient} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import {useEffect, useRef} from 'react';
import {useLoginAuth} from '#hooks/api/login-auth.js';
import {useLogoutAuth} from '#hooks/api/logout-auth.js';
import {useRefreshAuth} from '#hooks/api/refresh-auth.js';
import {useAuthState} from '#hooks/use-auth-state.js';
import {AuthProvider} from './auth-provider.js';

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'noe@example.com',
  name: 'Noe',
  email_verified_at: '2026-04-27T00:00:00.000Z',
  status: 'active' as const,
  created_at: '2026-04-27T00:00:00.000Z',
  updated_at: '2026-04-27T00:00:00.000Z',
};

const otherUser = {...user, id: '22222222-2222-4222-8222-222222222222', email: 'other@example.com'};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

function principalRefreshResponse(requestCount: number): Promise<Response> {
  if (requestCount === 1) {
    return Promise.resolve(jsonResponse({token: 'access-token', user}));
  }
  return Promise.resolve(jsonResponse({token: 'other-token-2', user: otherUser}));
}

function principalWorkspaceResponse(
  requestCount: number,
  initialWorkspaceRefresh: Promise<Response>,
): Promise<Response> {
  if (requestCount === 1) return initialWorkspaceRefresh;
  return Promise.resolve(jsonResponse({memberships: []}));
}

function StatusProbe() {
  const auth = useAuthState();
  const logout = useLogoutAuth();

  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="email">{auth.user?.email ?? 'none'}</span>
      <button type="button" onClick={() => void logout.mutateAsync()}>
        Logout
      </button>
    </div>
  );
}

function PrivateDataProbe() {
  const auth = useAuthState();
  const queryClient = useQueryClient();
  const seeded = useRef(false);
  const privateData = useQuery({
    queryKey: ['private-data'],
    queryFn: () => new Promise<string>(() => undefined),
    enabled: auth.isAuthenticated,
  });
  const login = useLoginAuth();

  useEffect(() => {
    if (!auth.isAuthenticated || seeded.current) return;
    seeded.current = true;
    queryClient.setQueryData(['private-data'], 'User A private data');
  }, [auth.isAuthenticated, queryClient]);

  return (
    <div>
      <span data-testid="private-data">{privateData.data ?? 'loading'}</span>
      <button
        type="button"
        onClick={() => void login.mutateAsync({email: 'other@example.com', password: 'password'})}
      >
        Switch user
      </button>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: fetch,
      getAccessToken: undefined,
      refreshAccessToken: undefined,
    });
  });

  test('boots from a successful refresh', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({token: 'access-token', user})));
    configureApiClient({fetchImpl});

    render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('email')).toHaveTextContent('noe@example.com');
  });

  test('treats refresh 401 as a guest session', async () => {
    const queryClient = new QueryClient();
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries');
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      );
    configureApiClient({fetchImpl});
    queryClient.setQueryData(['private-data'], 'private data');

    render(
      <AuthProvider queryClient={queryClient}>
        <StatusProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'));
    expect(screen.getByTestId('email')).toHaveTextContent('none');
    expect(cancelQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['private-data'])).toBeUndefined();
  });

  test('clears a hydrated private cache before accepting the first principal', async () => {
    const queryClient = new QueryClient();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({token: 'other-token', user: otherUser}));
    configureApiClient({fetchImpl});
    queryClient.setQueryData(['private-data'], 'previous principal private data');

    render(
      <AuthProvider queryClient={queryClient}>
        <StatusProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(queryClient.getQueryData(['private-data'])).toBeUndefined();
  });

  test('keeps the current session when refresh fails with a server error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({token: 'access-token', user}))
      .mockResolvedValueOnce(
        jsonResponse({code: 'internal-error', message: 'Internal Server Error'}, {status: 500}),
      );
    configureApiClient({fetchImpl});
    const onDone = vi.fn();

    function RefreshAfterBootProbe() {
      const auth = useAuthState();
      const refresh = useRefreshAuth();
      const didRefresh = useRef(false);

      useEffect(() => {
        if (auth.status !== 'authenticated' || didRefresh.current) return;
        didRefresh.current = true;
        void refresh().catch(onDone);
      }, [auth.status, refresh]);

      return <StatusProbe />;
    }

    render(
      <AuthProvider>
        <RefreshAfterBootProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('email')).toHaveTextContent('noe@example.com');
  });

  test('preserves private cached data when refresh returns the same user', async () => {
    const queryClient = new QueryClient();
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries');
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({token: 'access-token', user})));
    configureApiClient({fetchImpl});
    const onDone = vi.fn();
    const onReady = vi.fn();

    function RefreshAfterBootProbe() {
      const auth = useAuthState();
      const refresh = useRefreshAuth();
      const queryClient = useQueryClient();
      const didSeed = useRef(false);

      useEffect(() => {
        if (auth.status !== 'authenticated' || didSeed.current) return;
        didSeed.current = true;
        queryClient.setQueryData(['private-data'], 'current user private data');
        onReady();
      }, [auth.status, queryClient]);

      return (
        <>
          <StatusProbe />
          <button type="button" onClick={() => void refresh().then(onDone)}>
            Refresh
          </button>
        </>
      );
    }

    render(
      <AuthProvider queryClient={queryClient}>
        <RefreshAfterBootProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    cancelQueries.mockClear();
    screen.getByRole('button', {name: 'Refresh'}).click();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(cancelQueries).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['private-data'])).toBe('current user private data');
  });

  test('deduplicates concurrent refresh calls', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({token: 'access-token', user})));
    configureApiClient({fetchImpl});
    const onDone = vi.fn();

    function RefreshTwiceProbe() {
      const refresh = useRefreshAuth();

      useEffect(() => {
        void Promise.all([refresh(), refresh()]).then(onDone);
      }, [refresh]);

      return <StatusProbe />;
    }

    render(
      <AuthProvider>
        <RefreshTwiceProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('does not restore a stale refresh result after a principal transition', async () => {
    let refreshRequestCount = 0;
    let workspaceRequestCount = 0;
    const initialWorkspaceRefresh = new Promise<Response>(() => undefined);
    const onFreshRefresh = vi.fn();
    const onRefreshError = vi.fn();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = (input as Request).url;
      if (url.endsWith('/auth/refresh')) {
        refreshRequestCount += 1;
        return principalRefreshResponse(refreshRequestCount);
      }
      if (url.endsWith('/auth/login'))
        return Promise.resolve(jsonResponse({token: 'other-token', user: otherUser}));
      if (url.endsWith('/workspaces')) {
        workspaceRequestCount += 1;
        return principalWorkspaceResponse(workspaceRequestCount, initialWorkspaceRefresh);
      }
      return Promise.resolve(jsonResponse({token: 'access-token', user}));
    });
    configureApiClient({fetchImpl});

    function RefreshAndLoginProbe() {
      const auth = useAuthState();
      const login = useLoginAuth();
      const refresh = useRefreshAuth();

      useEffect(() => {
        void refresh().catch(onRefreshError);
      }, [refresh]);

      return (
        <div>
          <span data-testid="email">{auth.user?.email ?? 'none'}</span>
          <button
            type="button"
            onClick={() =>
              void login.mutateAsync({email: 'other@example.com', password: 'password'})
            }
          >
            Login as other user
          </button>
          <button type="button" onClick={() => void refresh().then(onFreshRefresh)}>
            Refresh current principal
          </button>
        </div>
      );
    }

    render(
      <AuthProvider>
        <RefreshAndLoginProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(workspaceRequestCount).toBe(1));
    screen.getByRole('button', {name: 'Login as other user'}).click();
    await waitFor(() => expect(screen.getByTestId('email')).toHaveTextContent('other@example.com'));
    await waitFor(() => expect(onRefreshError).toHaveBeenCalledTimes(1));
    const refreshError = onRefreshError.mock.calls[0]?.[0];
    expect(refreshError).toBeInstanceOf(ApiError);
    expect(refreshError).toMatchObject({code: 'unauthorized', status: 401});

    screen.getByRole('button', {name: 'Refresh current principal'}).click();
    await waitFor(() => expect(onFreshRefresh).toHaveBeenCalledTimes(1));
    expect(refreshRequestCount).toBe(2);

    expect(screen.getByTestId('email')).toHaveTextContent('other@example.com');
  });

  test('logout clears local state even when the API call fails', async () => {
    const queryClient = new QueryClient();
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({token: 'access-token', user}))
      .mockRejectedValueOnce(new Error('offline'));
    configureApiClient({fetchImpl});
    const onQueryAbort = vi.fn();

    render(
      <AuthProvider queryClient={queryClient}>
        <StatusProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    queryClient.setQueryData(['private-data'], 'private data');
    void queryClient
      .fetchQuery({
        queryKey: ['in-flight-private-data'],
        queryFn: ({signal}) =>
          new Promise<string>((_, reject) => {
            signal.addEventListener('abort', () => {
              onQueryAbort();
              reject(signal.reason);
            });
          }),
      })
      .catch(() => undefined);
    cancelQueries.mockClear();
    screen.getByRole('button', {name: 'Logout'}).click();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'));
    expect(cancelQueries).toHaveBeenCalledTimes(1);
    expect(onQueryAbort).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['private-data'])).toBeUndefined();
  });

  test('does not restore a session when logout supersedes workspace hydration', async () => {
    const workspaceRefreshStarted = vi.fn();
    let workspaceRequestCount = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (!request.url.endsWith('/workspaces'))
        return Promise.resolve(jsonResponse({token: 'access-token', user}));

      workspaceRequestCount += 1;
      if (workspaceRequestCount === 1) return Promise.resolve(jsonResponse({memberships: []}));

      workspaceRefreshStarted();
      return new Promise<Response>((_, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason));
      });
    });
    configureApiClient({fetchImpl});

    function LogoutDuringRefreshProbe() {
      const auth = useAuthState();
      const logout = useLogoutAuth();
      const refresh = useRefreshAuth();
      const didRefresh = useRef(false);

      useEffect(() => {
        if (auth.status !== 'authenticated' || didRefresh.current) return;
        didRefresh.current = true;
        void refresh();
      }, [auth.status, refresh]);

      return (
        <div>
          <span data-testid="status">{auth.status}</span>
          <button type="button" onClick={() => void logout.mutateAsync()}>
            Logout
          </button>
        </div>
      );
    }

    render(
      <AuthProvider>
        <LogoutDuringRefreshProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(workspaceRefreshStarted).toHaveBeenCalledTimes(1));
    screen.getByRole('button', {name: 'Logout'}).click();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'));
  });

  test('does not render cached private data after a user switch', async () => {
    const queryClient = new QueryClient();
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries');
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = (input as Request).url;
      if (url.endsWith('/auth/login'))
        return Promise.resolve(jsonResponse({token: 'other-token', user: otherUser}));
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      return Promise.resolve(jsonResponse({token: 'access-token', user}));
    });
    configureApiClient({fetchImpl});

    render(
      <AuthProvider queryClient={queryClient}>
        <PrivateDataProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('private-data')).toHaveTextContent('User A private data'),
    );
    cancelQueries.mockClear();
    screen.getByRole('button', {name: 'Switch user'}).click();

    await waitFor(() =>
      expect(screen.getByTestId('private-data')).not.toHaveTextContent('User A private data'),
    );
    expect(cancelQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['private-data'])).toBeUndefined();
  });
});
