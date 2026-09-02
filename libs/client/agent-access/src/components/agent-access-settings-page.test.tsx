import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactElement} from 'react';
import {AgentAccessSettingsPage} from './agent-access-settings-page.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const CREDENTIAL_ID = '33333333-3333-4333-8333-333333333333';

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
  test('filters connected grants and PATs to the active workspace', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith('/grants')) {
        return Promise.resolve(
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
      }
      return Promise.resolve(
        jsonResponse({
          pats: [
            patDto({name: 'Local agent'}),
            patDto({id: OTHER_WORKSPACE_ID, workspace_id: OTHER_WORKSPACE_ID, name: 'Hidden PAT'}),
          ],
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderSettings(<AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />);

    expect((await screen.findAllByText('Claude Desktop')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Local agent')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(screen.queryByText('Hidden PAT')).not.toBeInTheDocument();
  });

  test('keeps the create modal open while the one-time token request is pending', async () => {
    const user = userEvent.setup();
    let resolveCreate!: (response: Response) => void;
    const createResponse = new Promise<Response>((resolve) => {
      resolveCreate = resolve;
    });
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method === 'POST') return createResponse;
      if (request.url.endsWith('/grants')) return Promise.resolve(jsonResponse({grants: []}));
      return Promise.resolve(jsonResponse({pats: []}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    renderSettings(<AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />);

    await screen.findByText('No personal access tokens');
    await user.click(screen.getByRole('button', {name: 'Create token'}));
    fireEvent.change(await screen.findByLabelText('Token name'), {
      target: {value: 'Local coding agent'},
    });
    const createButtons = screen.getAllByRole('button', {name: 'Create token'});
    const createButton = createButtons.at(-1);
    if (!createButton) throw new Error('Create token button not rendered');
    await user.click(createButton);
    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog')).toBeVisible();

    resolveCreate(
      jsonResponse(
        {...patDto({name: 'Local coding agent'}), raw_token: 'sf_pat_secret-once'},
        {status: 201},
      ),
    );
    expect(await screen.findByText('sf_pat_secret-once')).toBeVisible();
  });

  test('reveals a created PAT once and clears it when the modal closes', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method === 'POST') {
        return Promise.resolve(
          jsonResponse(
            {
              ...patDto({name: 'Local coding agent'}),
              raw_token: 'sf_pat_secret-once',
            },
            {status: 201},
          ),
        );
      }
      if (request.url.endsWith('/grants')) return Promise.resolve(jsonResponse({grants: []}));
      return Promise.resolve(jsonResponse({pats: []}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    renderSettings(<AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />);

    await screen.findByText('No personal access tokens');
    await user.click(screen.getByRole('button', {name: 'Create token'}));
    fireEvent.change(await screen.findByLabelText('Token name'), {
      target: {value: 'Local coding agent'},
    });
    const createButtons = screen.getAllByRole('button', {name: 'Create token'});
    const createButton = createButtons.at(-1);
    if (!createButton) throw new Error('Create token button not rendered');
    await user.click(createButton);

    expect(await screen.findByText('sf_pat_secret-once')).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Done'}));
    expect(screen.queryByText('sf_pat_secret-once')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Create token'}));
    expect(await screen.findByLabelText('Token name')).toHaveValue('');
    expect(screen.queryByText('sf_pat_secret-once')).not.toBeInTheDocument();
  });

  test('confirms grant revocation and removes the revoked row', async () => {
    const user = userEvent.setup();
    let hasGrant = true;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith(`/grants/${CREDENTIAL_ID}`) && request.method === 'DELETE') {
        hasGrant = false;
        return Promise.resolve(new Response(null, {status: 204}));
      }
      if (request.url.endsWith('/grants')) {
        return Promise.resolve(jsonResponse({grants: hasGrant ? [grantDto()] : []}));
      }
      return Promise.resolve(jsonResponse({pats: []}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    renderSettings(<AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />);

    expect((await screen.findAllByText('Claude Desktop')).length).toBeGreaterThan(0);
    const revokeButton = screen.getAllByRole('button', {name: 'Revoke Claude Desktop'})[0];
    if (!revokeButton) throw new Error('Revoke grant button not rendered');
    await user.click(revokeButton);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', {name: 'Revoke agent access?'})).toBeVisible();
    await user.click(within(dialog).getByRole('button', {name: 'Revoke'}));

    await waitFor(() => expect(screen.getByText('No connected agents')).toBeVisible());
  });
});

function grantDto(overrides: Record<string, unknown> = {}) {
  return {
    id: CREDENTIAL_ID,
    client_name: 'Claude Desktop',
    workspace_id: WORKSPACE_ID,
    scopes: ['read'],
    created_at: '2026-09-01T10:00:00.000Z',
    last_refreshed_at: '2026-09-02T10:00:00.000Z',
    ...overrides,
  };
}

function patDto(overrides: Record<string, unknown> = {}) {
  return {
    id: CREDENTIAL_ID,
    workspace_id: WORKSPACE_ID,
    prefix: 'sf_pat_example',
    name: 'Local agent',
    expires_at: '2026-12-01T10:00:00.000Z',
    last_used_at: null,
    created_at: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}
