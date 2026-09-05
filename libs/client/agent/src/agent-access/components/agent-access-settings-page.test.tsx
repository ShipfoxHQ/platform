import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactElement} from 'react';
import {AgentAccessSettingsPage} from './agent-access-settings-page.js';
import {formatAgentAccessDate, formatAgentAccessTimestamp} from './format.js';

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

  test('reveals exact app identity and timestamps to keyboard users', async () => {
    const user = userEvent.setup();
    const clientName = `Claude Desktop ${'connection-name-'.repeat(10)}`;
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        grants: [grantDto({client_name: clientName})],
      }),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    renderSettings(<AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />);

    expect((await screen.findAllByText(clientName)).length).toBeGreaterThan(0);
    const connectedDate = screen.getAllByText(formatAgentAccessDate('2026-09-01T10:00:00.000Z'))[0];
    const timestampTrigger = connectedDate?.closest('button');
    if (!timestampTrigger) throw new Error('Connected timestamp trigger not rendered');
    act(() => timestampTrigger.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      formatAgentAccessTimestamp('2026-09-01T10:00:00.000Z') ?? '',
    );

    const revokeButton = screen.getAllByRole('button', {name: `Disconnect ${clientName}`})[0];
    if (!revokeButton) throw new Error('Disconnect button not rendered');
    await user.click(revokeButton);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(clientName)).toBeVisible();
  });

  test('keeps the disconnect dialog retryable when revocation fails', async () => {
    const user = userEvent.setup();
    let deleteCount = 0;
    let hasGrant = true;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith(`/grants/${GRANT_ID}`) && request.method === 'DELETE') {
        deleteCount += 1;
        if (deleteCount === 1) {
          return Promise.resolve(
            jsonResponse(
              {code: 'auth-dependency-unavailable', message: 'Temporarily unavailable'},
              {status: 503},
            ),
          );
        }
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
    const confirmButton = within(dialog).getByRole('button', {name: 'Disconnect app'});
    await user.click(confirmButton);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'MCP connections are temporarily unavailable. Try again in a moment.',
    );
    expect(dialog).toBeVisible();
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);

    await waitFor(() => expect(deleteCount).toBe(2));
    expect(screen.getByText('No connected apps')).toBeVisible();
    expect(dialog).not.toBeInTheDocument();
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
