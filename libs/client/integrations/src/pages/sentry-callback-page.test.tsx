// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {ApiError} from '@shipfox/client-api';
import {fireEvent, screen, waitFor} from '@testing-library/react';
import {renderIntegrationsPage, testWorkspace} from '#test/render.js';
import {SentryCallbackPage} from './sentry-callback-page.js';

const {connectSentryMock} = vi.hoisted(() => ({connectSentryMock: vi.fn()}));

const MISSING_PARAMS_RE = /missing required parameters/;

vi.mock('@shipfox/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipfox/client-auth')>();
  return {
    ...actual,
    useRefreshAuth: () => () => Promise.resolve({accessToken: 'test-token'}),
  };
});

vi.mock('#hooks/api/integrations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#hooks/api/integrations.js')>();
  return {
    ...actual,
    connectSentry: (...args: unknown[]) => connectSentryMock(...args) as never,
  };
});

function renderCallback(options: {
  installationId: string;
  orgSlug?: string;
  workspaces?: Parameters<typeof renderIntegrationsPage>[0]['workspaces'];
  search?: string;
  loadingAuth?: boolean;
}) {
  const search =
    options.search ??
    `?code=the-code&installationId=${options.installationId}${
      options.orgSlug ? `&orgSlug=${options.orgSlug}` : ''
    }`;
  return renderIntegrationsPage({
    path: `/integrations/sentry/callback${search}`,
    routePath: '/integrations/sentry/callback',
    element: <SentryCallbackPage />,
    extraRoutes: ['/workspaces/$wid/settings/integrations', '/workspaces/$wid/integrations/sentry'],
    ...(options.workspaces ? {workspaces: options.workspaces} : {}),
    ...(options.loadingAuth ? {loadingAuth: true} : {}),
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
  connectSentryMock.mockReset();
});

describe('SentryCallbackPage', () => {
  test('always asks for confirmation and never auto-installs', async () => {
    renderCallback({installationId: 'install-confirm', orgSlug: 'acme'});

    expect(await screen.findByText('Install the Sentry org "acme" in a workspace.')).toBeVisible();
    expect(screen.getByRole('button', {name: 'Install'})).toBeVisible();
    expect(connectSentryMock).not.toHaveBeenCalled();
  });

  test('waits for auth instead of bouncing away and discarding the grant code', async () => {
    // On a cold return from Sentry, auth is still loading and `workspaces` is
    // empty; the page must hold a loader, not treat that as "no workspace".
    renderCallback({installationId: 'install-loading', loadingAuth: true});

    expect(await screen.findByRole('status', {name: 'Loading'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Install'})).not.toBeInTheDocument();
    expect(connectSentryMock).not.toHaveBeenCalled();
  });

  test('lists every workspace when several exist', async () => {
    renderCallback({
      installationId: 'install-multi',
      workspaces: [
        testWorkspace(),
        testWorkspace({
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Beta',
          membershipId: 'm-2',
        }),
      ],
    });

    expect(await screen.findByText('Acme')).toBeVisible();
    expect(screen.getByText('Beta')).toBeVisible();
    expect(screen.getAllByRole('button', {name: 'Install'})).toHaveLength(2);
  });

  test('renders a terminal state when params are missing', async () => {
    renderCallback({installationId: 'unused', search: '?installationId=only-id'});

    // Alert mounts via framer-motion (opacity 0 in jsdom), so assert presence.
    expect(await screen.findByText(MISSING_PARAMS_RE)).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Install'})).not.toBeInTheDocument();
    expect(connectSentryMock).not.toHaveBeenCalled();
  });

  test('installs on click and lands on the settings integrations page', async () => {
    connectSentryMock.mockResolvedValue({});
    renderCallback({installationId: 'install-success'});

    fireEvent.click(await screen.findByRole('button', {name: 'Install'}));

    await screen.findByTestId('route:/workspaces/$wid/settings/integrations');
    expect(connectSentryMock).toHaveBeenCalledWith({
      body: {
        workspace_id: testWorkspace().id,
        code: 'the-code',
        installation_id: 'install-success',
      },
      token: 'test-token',
    });
  });

  test('retry after a transient failure issues a fresh request', async () => {
    connectSentryMock
      .mockRejectedValueOnce(
        new ApiError({message: 'down', code: 'provider-unavailable', status: 503}),
      )
      .mockResolvedValueOnce({});
    renderCallback({installationId: 'install-retry'});

    fireEvent.click(await screen.findByRole('button', {name: 'Install'}));
    fireEvent.click(await screen.findByRole('button', {name: 'Retry'}));

    await screen.findByTestId('route:/workspaces/$wid/settings/integrations');
    expect(connectSentryMock).toHaveBeenCalledTimes(2);
  });

  test('a non-rate-limited failure re-enables Retry after a rate-limit lock', async () => {
    connectSentryMock
      .mockRejectedValueOnce(
        new ApiError({
          message: 'slow down',
          code: 'rate-limited',
          status: 429,
          // Real wire shape: client-api stores the whole {code, details} body as ApiError.details.
          details: {code: 'rate-limited', details: {retry_after_seconds: 60}},
        }),
      )
      .mockRejectedValueOnce(new ApiError({message: 'down', code: 'timeout', status: 503}));
    renderCallback({installationId: 'install-lock-recover'});

    // First failure is rate-limited, so the lock disables Retry.
    fireEvent.click(await screen.findByRole('button', {name: 'Install'}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Retry'})).toBeDisabled());

    // A second attempt (via the still-enabled workspace Install) fails with no
    // backoff hint: the lock must clear so the user is not stranded.
    fireEvent.click(screen.getByRole('button', {name: 'Install'}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Retry'})).toBeEnabled());
  });

  test('terminal 422 offers start-over, not retry', async () => {
    connectSentryMock.mockRejectedValue(
      new ApiError({message: 'Sentry rejected the code.', code: 'access-denied', status: 422}),
    );
    renderCallback({installationId: 'install-terminal'});

    fireEvent.click(await screen.findByRole('button', {name: 'Install'}));

    expect(
      await screen.findByText(
        'Sentry did not accept this install. Start the install again from workspace settings.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Start over'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Retry'})).not.toBeInTheDocument();
  });

  test('409 already-linked is terminal without retry or start-over', async () => {
    connectSentryMock.mockRejectedValue(
      new ApiError({
        message: 'already linked',
        code: 'sentry-installation-already-linked',
        status: 409,
      }),
    );
    renderCallback({installationId: 'install-409'});

    fireEvent.click(await screen.findByRole('button', {name: 'Install'}));

    expect(
      await screen.findByText('This Sentry org is already installed in another workspace.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Retry'})).not.toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Start over'})).not.toBeInTheDocument();
  });

  test('retry after failure works across a remount (no cached rejection)', async () => {
    connectSentryMock.mockRejectedValue(
      new ApiError({message: 'down', code: 'timeout', status: 503}),
    );
    const first = renderCallback({installationId: 'install-remount'});
    fireEvent.click(await screen.findByRole('button', {name: 'Install'}));
    await screen.findByRole('button', {name: 'Retry'});
    first.unmount();

    connectSentryMock.mockResolvedValue({});
    renderCallback({installationId: 'install-remount'});
    fireEvent.click(await screen.findByRole('button', {name: 'Install'}));

    await screen.findByTestId('route:/workspaces/$wid/settings/integrations');
    await waitFor(() => expect(connectSentryMock).toHaveBeenCalledTimes(2));
  });
});
