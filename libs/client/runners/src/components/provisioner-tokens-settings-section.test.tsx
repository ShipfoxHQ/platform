import {configureApiClient} from '@shipfox/client-api';
import {Toaster} from '@shipfox/react-ui/toast';
import {formatDate, formatTimestamp} from '@shipfox/react-ui/utils';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactElement} from 'react';
import {WorkspaceProvisionerTokensSettingsSection} from './provisioner-tokens-settings-section.js';

const RUNNERS_TEST_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROVISIONER_TOKEN_ID = '33333333-3333-4333-8333-333333333333';
const LAST_SEEN_TEXT = /Last seen/;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function provisionerToken(overrides: Partial<Record<string, string | null>> = {}) {
  return {
    id: PROVISIONER_TOKEN_ID,
    scope: 'workspace',
    workspace_id: RUNNERS_TEST_WORKSPACE_ID,
    prefix: 'sf_pt_abcde',
    name: 'Docker provisioner',
    created_by_user_id: '22222222-2222-4222-8222-222222222222',
    revoked_by_user_id: null,
    expires_at: '2026-05-09T00:00:00.000Z',
    revoked_at: null,
    last_seen_at: null,
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
    ...overrides,
  };
}

function activeProvisioner(overrides: Partial<Record<string, string | null>> = {}) {
  return {
    id: PROVISIONER_TOKEN_ID,
    name: 'Docker provisioner',
    prefix: 'sf_pt_abcde',
    last_seen_at: '2026-05-08T01:00:00.000Z',
    ...overrides,
  };
}

function renderProvisionerTokens(element: ReactElement) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});

  return render(
    <QueryClientProvider client={queryClient}>
      {element}
      <Toaster />
    </QueryClientProvider>,
  );
}

function firstButton(name: string): HTMLElement {
  const button = screen.getAllByRole('button', {name})[0];
  if (!button) throw new Error(`Button not found: ${name}`);
  return button;
}

function lastButton(name: string): HTMLElement {
  const buttons = screen.getAllByRole('button', {name});
  const button = buttons.at(-1);
  if (!button) throw new Error(`Button not found: ${name}`);
  return button;
}

async function chooseTokenAction(user: ReturnType<typeof userEvent.setup>, tokenName: string) {
  await user.click(firstButton(`Open ${tokenName} token actions`));
  const menuItem = await screen.findByRole('menuitem', {name: 'Revoke token'});
  expect(menuItem.querySelector('svg')).not.toBeInTheDocument();

  await user.click(menuItem);
  expect(await screen.findByRole('dialog')).toBeVisible();
  expect(screen.getByText('Revoke token?')).toBeVisible();
}

describe('WorkspaceProvisionerTokensSettingsSection', () => {
  test('renders an empty usable-token state', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith('/provisioners/active')) {
        return Promise.resolve(jsonResponse({provisioners: [], installation_runners: 'none'}));
      }
      return Promise.resolve(jsonResponse({tokens: []}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderProvisionerTokens(
      <WorkspaceProvisionerTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );

    expect(await screen.findByText('No usable provisioner registration tokens')).toBeVisible();
    expect(screen.getByRole('button', {name: 'Create token'})).toBeVisible();
  });

  test('creates a token and reveals the raw token inline once', async () => {
    const user = userEvent.setup();
    let tokens = [] as ReturnType<typeof provisionerToken>[];
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith('/provisioners/active')) {
        return Promise.resolve(jsonResponse({provisioners: [], installation_runners: 'none'}));
      }
      if (request.method === 'POST' && request.url.endsWith('/provisioners/tokens')) {
        tokens = [provisionerToken({name: 'Docker provisioner'})];
        return Promise.resolve(
          jsonResponse(
            {
              ...provisionerToken({name: 'Docker provisioner'}),
              raw_token: 'sf_pt_raw-created-token',
            },
            {status: 201},
          ),
        );
      }
      return Promise.resolve(jsonResponse({tokens}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderProvisionerTokens(
      <WorkspaceProvisionerTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );
    await screen.findByText('No usable provisioner registration tokens');
    await user.click(screen.getByRole('button', {name: 'Create token'}));
    fireEvent.change(await screen.findByLabelText('Token name'), {
      target: {value: 'Docker provisioner'},
    });
    await user.click(lastButton('Create token'));

    expect(await screen.findByText('Token created')).toBeVisible();
    expect(screen.getByText('sf_pt_raw-created-token')).toBeVisible();
  });

  test('renders compact dates with exact timestamp tooltips', async () => {
    const user = userEvent.setup();
    const createdAt = '2026-05-08T00:00:00.000Z';
    const expiresAt = '2026-05-09T00:00:00.000Z';
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith('/provisioners/active')) {
        return Promise.resolve(jsonResponse({provisioners: [], installation_runners: 'none'}));
      }
      return Promise.resolve(
        jsonResponse({
          tokens: [provisionerToken({created_at: createdAt, expires_at: expiresAt})],
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderProvisionerTokens(
      <WorkspaceProvisionerTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );
    const expiresDate = await screen.findAllByText(formatDate(expiresAt));
    const createdDate = await screen.findAllByText(formatDate(createdAt));
    const expiresDateTrigger = expiresDate[0];
    const createdDateTrigger = createdDate[0];
    if (!expiresDateTrigger || !createdDateTrigger) throw new Error('Token dates not rendered');

    expect(screen.queryByText(formatTimestamp(expiresAt))).not.toBeInTheDocument();
    await user.hover(expiresDateTrigger);

    expect(await screen.findByRole('tooltip')).toHaveTextContent(formatTimestamp(expiresAt));

    await user.unhover(expiresDateTrigger);
    await user.hover(createdDateTrigger);

    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveTextContent(formatTimestamp(createdAt));
    });
  });

  test('truncates long token names and shows the full name in a tooltip', async () => {
    const user = userEvent.setup();
    const tokenName = 'docker-provisioner-for-west-coast-gpu-burst-capacity-and-fallback';
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith('/provisioners/active')) {
        return Promise.resolve(jsonResponse({provisioners: [], installation_runners: 'none'}));
      }
      return Promise.resolve(jsonResponse({tokens: [provisionerToken({name: tokenName})]}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderProvisionerTokens(
      <WorkspaceProvisionerTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );
    const nameTrigger = await screen.findAllByRole('button', {name: tokenName});
    const visibleNameTrigger = nameTrigger[0];
    if (!visibleNameTrigger) throw new Error('Token name not rendered');

    expect(screen.getByRole('table')).toHaveClass('table-fixed');
    expect(visibleNameTrigger).toHaveClass('truncate');
    await user.hover(visibleNameTrigger);

    expect(await screen.findByRole('tooltip')).toHaveTextContent(tokenName);
  });

  test('surfaces create errors without clearing the form', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith('/provisioners/active')) {
        return Promise.resolve(jsonResponse({provisioners: [], installation_runners: 'none'}));
      }
      if (request.method === 'POST' && request.url.endsWith('/provisioners/tokens')) {
        return Promise.resolve(
          jsonResponse({message: 'Token quota reached', code: 'quota-reached'}, {status: 422}),
        );
      }
      return Promise.resolve(jsonResponse({tokens: []}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderProvisionerTokens(
      <WorkspaceProvisionerTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );
    await screen.findByText('No usable provisioner registration tokens');
    await user.click(screen.getByRole('button', {name: 'Create token'}));
    fireEvent.change(await screen.findByLabelText('Token name'), {
      target: {value: 'Docker provisioner'},
    });
    await user.click(lastButton('Create token'));

    expect(await screen.findByText('Could not create token')).toBeVisible();
    expect(screen.getByText('Token quota reached')).toBeVisible();
    expect(screen.getByLabelText('Token name')).toHaveValue('Docker provisioner');
  });

  test('renders connected, last-seen, and never-connected statuses', async () => {
    const activeId = '44444444-4444-4444-8444-444444444444';
    const staleId = '55555555-5555-4555-8555-555555555555';
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith('/provisioners/active')) {
        return Promise.resolve(
          jsonResponse({
            provisioners: [activeProvisioner({id: activeId, name: 'Active provisioner'})],
            installation_runners: 'none',
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          tokens: [
            provisionerToken({id: activeId, name: 'Active provisioner'}),
            provisionerToken({
              id: staleId,
              name: 'Stale provisioner',
              last_seen_at: '2026-05-08T01:00:00.000Z',
            }),
            provisionerToken({name: 'New provisioner'}),
          ],
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderProvisionerTokens(
      <WorkspaceProvisionerTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );

    expect((await screen.findAllByText('Connected')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(LAST_SEEN_TEXT).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Never connected').length).toBeGreaterThan(0);
  });

  test('renders recency when active provisioners cannot load', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith('/provisioners/active')) {
        return Promise.resolve(
          jsonResponse({message: 'Server error', code: 'server-error'}, {status: 500}),
        );
      }
      return Promise.resolve(
        jsonResponse({
          tokens: [
            provisionerToken({
              last_seen_at: '2026-05-08T01:00:00.000Z',
            }),
          ],
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderProvisionerTokens(
      <WorkspaceProvisionerTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );

    expect((await screen.findAllByText(LAST_SEEN_TEXT)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Docker provisioner').length).toBeGreaterThan(0);
    expect(
      screen.queryByText('Could not load provisioner registration tokens'),
    ).not.toBeInTheDocument();
  });

  test('revokes a token after row confirmation and removes it from the list', async () => {
    const user = userEvent.setup();
    let tokens = [provisionerToken()];
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith('/provisioners/active')) {
        return Promise.resolve(jsonResponse({provisioners: [], installation_runners: 'none'}));
      }
      if (request.method === 'POST' && request.url.includes('/revoke')) {
        tokens = [];
        return Promise.resolve(
          jsonResponse(
            provisionerToken({
              revoked_at: '2026-05-08T01:00:00.000Z',
              revoked_by_user_id: '22222222-2222-4222-8222-222222222222',
            }),
          ),
        );
      }
      return Promise.resolve(jsonResponse({tokens}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderProvisionerTokens(
      <WorkspaceProvisionerTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );
    expect((await screen.findAllByText('Docker provisioner')).length).toBeGreaterThan(0);
    await chooseTokenAction(user, 'Docker provisioner');
    await user.click(lastButton('Revoke'));

    await waitFor(() => expect(screen.queryByText('Docker provisioner')).not.toBeInTheDocument());
    expect(screen.getByText('No usable provisioner registration tokens')).toBeVisible();
  });

  test('shows a recoverable revoke error', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith('/provisioners/active')) {
        return Promise.resolve(jsonResponse({provisioners: [], installation_runners: 'none'}));
      }
      if (request.method === 'POST' && request.url.includes('/revoke')) {
        return Promise.resolve(
          jsonResponse({message: 'Provisioner token not found', code: 'not-found'}, {status: 404}),
        );
      }
      return Promise.resolve(jsonResponse({tokens: [provisionerToken()]}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderProvisionerTokens(
      <WorkspaceProvisionerTokensSettingsSection workspaceId={RUNNERS_TEST_WORKSPACE_ID} />,
    );
    expect((await screen.findAllByText('Docker provisioner')).length).toBeGreaterThan(0);
    await chooseTokenAction(user, 'Docker provisioner');
    await user.click(lastButton('Revoke'));

    expect(await screen.findByText('Provisioner token not found')).toBeVisible();
    expect(screen.getAllByText('Docker provisioner').length).toBeGreaterThan(0);
  });
});
