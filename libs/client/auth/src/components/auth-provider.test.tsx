import {configureApiClient} from '@shipfox/client-api';
import {render, screen, waitFor} from '@testing-library/react';
import {useEffect, useRef} from 'react';
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

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

function delayedJsonResponse(body: unknown): Promise<Response> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(jsonResponse(body)), 5);
  });
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
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({token: 'access-token', user}));
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
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      );
    configureApiClient({fetchImpl});

    render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'));
    expect(screen.getByTestId('email')).toHaveTextContent('none');
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

  test('deduplicates concurrent refresh calls', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => delayedJsonResponse({token: 'access-token', user}));
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

  test('logout clears local state even when the API call fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({token: 'access-token', user}))
      .mockRejectedValueOnce(new Error('offline'));
    configureApiClient({fetchImpl});

    render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    screen.getByRole('button', {name: 'Logout'}).click();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'));
  });
});
