import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {OAuthConsentPage, OAuthConsentRoutePage} from './oauth-consent-page.js';

const runtimeMocks = vi.hoisted(() => ({
  useAuthState: vi.fn(),
  useRouteSearch: vi.fn(),
}));

vi.mock('@shipfox/client-shell/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipfox/client-shell/runtime')>();
  return {
    ...actual,
    useAuthState: runtimeMocks.useAuthState,
    useRouteSearch: runtimeMocks.useRouteSearch,
  };
});

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function consentResponse() {
  return {
    request_id: REQUEST_ID,
    client_name: 'Claude Desktop',
    scope: 'read',
    expires_at: '2026-09-02T12:30:00.000Z',
    redirect_uri_hostname: '127.0.0.1',
    client_identity_origin: 'https://claude.ai',
    is_loopback_redirect: true,
    workspaces: [{workspace_id: WORKSPACE_ID, role: 'owner'}],
  };
}

function renderConsent(onRedirect = vi.fn()) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return {
    onRedirect,
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <OAuthConsentPage requestId={REQUEST_ID} onRedirect={onRedirect} />
      </QueryClientProvider>,
    ),
  };
}

function renderConsentRoute(onGuestRedirect = vi.fn()) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const route = () => (
    <QueryClientProvider client={queryClient}>
      <OAuthConsentRoutePage onGuestRedirect={onGuestRedirect} />
    </QueryClientProvider>
  );
  const view = render(route());
  return {...view, onGuestRedirect, route};
}

describe('OAuthConsentPage', () => {
  beforeEach(() => {
    runtimeMocks.useAuthState.mockReset();
    runtimeMocks.useRouteSearch.mockReset();
    runtimeMocks.useAuthState.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      workspaces: [],
    });
    runtimeMocks.useRouteSearch.mockReturnValue({requestId: REQUEST_ID});
  });

  afterEach(() => window.history.replaceState({}, '', '/'));

  test('waits for the auth session before loading the connection request', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(consentResponse()));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    runtimeMocks.useAuthState.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      workspaces: [],
    });
    const {rerender, route} = renderConsentRoute();

    expect(screen.getByRole('status', {name: 'Loading connection request'})).toBeVisible();
    expect(screen.queryByText('Could not load connection request')).not.toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();

    runtimeMocks.useAuthState.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      workspaces: [],
    });
    rerender(route());

    expect(
      await screen.findByRole('heading', {name: 'Allow Claude Desktop to access Shipfox?'}),
    ).toBeVisible();
    expect(
      screen.queryByRole('status', {name: 'Loading connection request'}),
    ).not.toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('redirects a guest to sign in before loading the connection request', async () => {
    window.history.replaceState({}, '', `/oauth/consent?request_id=${REQUEST_ID}#review`);
    const fetchImpl = vi.fn(async () => jsonResponse({code: 'unauthorized'}, {status: 401}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    runtimeMocks.useAuthState.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      workspaces: [],
    });
    const {onGuestRedirect} = renderConsentRoute();

    await waitFor(() =>
      expect(onGuestRedirect).toHaveBeenCalledWith(
        `/auth/login?redirect=${encodeURIComponent(
          `/oauth/consent?request_id=${REQUEST_ID}#review`,
        )}`,
      ),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.queryByText('Could not load connection request')).not.toBeInTheDocument();
  });

  test('shows verified request facts and requires an explicit approval click', async () => {
    const user = userEvent.setup();
    let approvalBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith('/approve')) {
        approvalBody = await request.clone().json();
        return jsonResponse({redirect_url: 'http://127.0.0.1:4567/callback?code=server-code'});
      }
      return jsonResponse(consentResponse());
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {onRedirect} = renderConsent();

    expect(
      await screen.findByRole('heading', {
        name: 'Allow Claude Desktop to access Shipfox?',
      }),
    ).toBeVisible();
    expect(screen.getByText('https://claude.ai')).toBeVisible();
    expect(screen.getByText('Read workspace data')).toBeVisible();
    expect(screen.getByText('Claude Desktop on this device')).toBeVisible();
    expect(screen.queryByText(WORKSPACE_ID)).not.toBeInTheDocument();
    expect(screen.queryByText('owner')).not.toBeInTheDocument();
    expect(screen.getByText('Current workspace')).toBeVisible();
    expect(onRedirect).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', {name: 'Allow access'}));

    expect(onRedirect).toHaveBeenCalledWith('http://127.0.0.1:4567/callback?code=server-code');
    expect(approvalBody).toEqual({workspace_id: WORKSPACE_ID});
  });

  test('uses the server redirect for denial', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      return Promise.resolve(
        request.url.endsWith('/deny')
          ? jsonResponse({redirect_url: 'https://agent.example.test/denied'})
          : jsonResponse(consentResponse()),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {onRedirect} = renderConsent();

    await screen.findByText('Claude Desktop');
    await user.click(screen.getByRole('button', {name: 'Deny'}));

    expect(onRedirect).toHaveBeenCalledWith('https://agent.example.test/denied');
  });

  test('keeps consent actions retryable when approval fails', async () => {
    const user = userEvent.setup();
    let approvalCount = 0;
    let resolveApproval: (response: Response) => void = () => undefined;
    const approvalResponse = new Promise<Response>((resolve) => {
      resolveApproval = resolve;
    });
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (!request.url.endsWith('/approve')) {
        return Promise.resolve(jsonResponse(consentResponse()));
      }
      approvalCount += 1;
      return approvalCount === 1
        ? approvalResponse
        : Promise.resolve(
            jsonResponse({redirect_url: 'http://127.0.0.1:4567/callback?code=retry-code'}),
          );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {onRedirect} = renderConsent();

    await screen.findByText('Claude Desktop');
    const approveButton = screen.getByRole('button', {name: 'Allow access'});
    const denyButton = screen.getByRole('button', {name: 'Deny'});
    await user.click(approveButton);
    expect(denyButton).toBeDisabled();

    resolveApproval(
      jsonResponse(
        {code: 'auth-dependency-unavailable', message: 'Temporarily unavailable'},
        {status: 503},
      ),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This connection request is temporarily unavailable. Try again in a moment.',
    );
    expect(approveButton).toBeEnabled();
    expect(denyButton).toBeEnabled();
    expect(onRedirect).not.toHaveBeenCalled();

    await user.click(approveButton);

    await waitFor(() => expect(approvalCount).toBe(2));
    expect(onRedirect).toHaveBeenCalledWith('http://127.0.0.1:4567/callback?code=retry-code');
  });

  test('preserves loaded consent details when a background refetch fails', async () => {
    let requestCount = 0;
    const fetchImpl = vi.fn(() => {
      requestCount += 1;
      return Promise.resolve(
        requestCount === 1
          ? jsonResponse(consentResponse())
          : jsonResponse(
              {code: 'auth-dependency-unavailable', message: 'Temporarily unavailable'},
              {status: 503},
            ),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {queryClient} = renderConsent();
    await screen.findByRole('heading', {name: 'Allow Claude Desktop to access Shipfox?'});

    await act(async () => {
      await queryClient.refetchQueries();
    });

    expect(
      screen.getByRole('heading', {name: 'Allow Claude Desktop to access Shipfox?'}),
    ).toBeVisible();
    expect(
      screen.queryByText(
        'This connection request is temporarily unavailable. Try again in a moment.',
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'This connection request expired or is no longer available. Return to your MCP client and start again.',
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'This connection request is invalid. Return to your MCP client and start again.',
      ),
    ).not.toBeInTheDocument();
  });
});
