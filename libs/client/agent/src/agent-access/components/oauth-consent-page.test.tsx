import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {OAuthConsentPage} from './oauth-consent-page.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const LOOPBACK_WARNING_RE = /app running on this device/i;

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

describe('OAuthConsentPage', () => {
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
    expect(screen.getByText('127.0.0.1')).toBeVisible();
    expect(screen.getByText('Read-only')).toBeVisible();
    expect(screen.getByText(LOOPBACK_WARNING_RE)).toBeVisible();
    expect(screen.getByRole('radio')).toBeChecked();
    expect(onRedirect).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', {name: 'Allow read-only access'}));

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
      screen.queryByText('Agent access is temporarily unavailable. Try again in a moment.'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'This access request expired or is no longer available. Return to the agent and start again.',
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('This access request is invalid. Return to the agent and start again.'),
    ).not.toBeInTheDocument();
  });
});
