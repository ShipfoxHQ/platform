import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactElement} from 'react';
import {AgentAccessSettingsPage} from './agent-access-settings-page.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const GRANT_ID = '33333333-3333-4333-8333-333333333333';
const REVOCATION_WINDOW_COPY = /continue for up to 15 minutes/;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function renderSettings(element: ReactElement) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
}

describe('AgentAccessSettingsPage', () => {
  test('shows only OAuth apps authorized for the active workspace', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        grants: [
          grantDto({client_name: 'Claude Desktop'}),
          grantDto({
            id: OTHER_WORKSPACE_ID,
            workspace_id: OTHER_WORKSPACE_ID,
            client_name: 'Hidden',
          }),
        ],
      }),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderSettings(<AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />);

    expect((await screen.findAllByText('Claude Desktop')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Connected apps'})).toBeVisible();
  });

  test('confirms OAuth revocation with its actual propagation window', async () => {
    const user = userEvent.setup();
    let hasGrant = true;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith(`/grants/${GRANT_ID}`) && request.method === 'DELETE') {
        hasGrant = false;
        return Promise.resolve(new Response(null, {status: 204}));
      }
      return Promise.resolve(jsonResponse({grants: hasGrant ? [grantDto()] : []}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    renderSettings(<AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />);

    expect((await screen.findAllByText('Claude Desktop')).length).toBeGreaterThan(0);
    const revokeButton = screen.getAllByRole('button', {name: 'Disconnect Claude Desktop'})[0];
    if (!revokeButton) throw new Error('Disconnect button not rendered');
    await user.click(revokeButton);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', {name: 'Disconnect Claude Desktop?'})).toBeVisible();
    expect(within(dialog).getByText(REVOCATION_WINDOW_COPY)).toBeVisible();
    await user.click(within(dialog).getByRole('button', {name: 'Disconnect app'}));

    await waitFor(() => expect(screen.getByText('No connected apps')).toBeVisible());
  });
});

function grantDto(overrides: Record<string, unknown> = {}) {
  return {
    id: GRANT_ID,
    client_name: 'Claude Desktop',
    workspace_id: WORKSPACE_ID,
    scopes: ['read'],
    created_at: '2026-09-01T10:00:00.000Z',
    last_refreshed_at: '2026-09-02T10:00:00.000Z',
    ...overrides,
  };
}
