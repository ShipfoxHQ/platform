// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {ApiError} from '@shipfox/client-api';
import {screen, waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {LINEAR_INSTALL_WORKSPACE_KEY} from '#linear-callback.js';
import {INTEGRATIONS_TEST_WID, renderIntegrationsPage, testWorkspace} from '#test/render.js';
import {LinearCallbackPage} from './linear-callback-page.js';

const {completeCallbackMock} = vi.hoisted(() => ({completeCallbackMock: vi.fn()}));

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
    useCompleteLinearCallbackMutation: () => ({mutateAsync: completeCallbackMock}),
  };
});

function renderCallback(search: string, options?: {strict?: boolean}) {
  return renderIntegrationsPage({
    path: `/integrations/linear/callback${search}`,
    routePath: '/integrations/linear/callback',
    element: options?.strict ? (
      <StrictMode>
        <LinearCallbackPage />
      </StrictMode>
    ) : (
      <LinearCallbackPage />
    ),
    extraRoutes: [
      '/w/$workspaceSlug/settings/integrations',
      '/w/$workspaceSlug/integrations/linear',
      '/auth/login',
    ],
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
  completeCallbackMock.mockReset();
});

describe('LinearCallbackPage', () => {
  test('renders the recovery page without submitting malformed callbacks', async () => {
    window.sessionStorage.setItem(LINEAR_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);

    renderCallback('?state=signed-state');

    const heading = await screen.findByRole('heading', {name: 'Invalid Linear callback'});

    expect(heading).toBeVisible();
    expect(completeCallbackMock).not.toHaveBeenCalled();
    expect(screen.getByRole('link', {name: 'Start over'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'Back to integrations'})).toBeVisible();
    expect(document.activeElement).toBe(heading);
    expect(heading).toHaveClass('outline-none');
  });

  test('submits a callback once in Strict Mode, clears the handoff, and navigates to the response workspace', async () => {
    const responseWorkspaceId = '22222222-2222-4222-8222-222222222222';
    window.sessionStorage.setItem(LINEAR_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);
    completeCallbackMock.mockResolvedValue({
      id: 'connection-1',
      workspaceId: responseWorkspaceId,
      provider: 'linear',
      external_account_id: 'linear-org',
      slug: 'linear_org',
      display_name: 'Linear org',
      lifecycle_status: 'active',
      capabilities: [],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    renderIntegrationsPage({
      path: '/integrations/linear/callback?code=grant-code-success&state=signed-state-success',
      routePath: '/integrations/linear/callback',
      element: (
        <StrictMode>
          <LinearCallbackPage />
        </StrictMode>
      ),
      workspaces: [
        testWorkspace(),
        testWorkspace({id: responseWorkspaceId, slug: 'response-workspace'}),
      ],
      extraRoutes: [
        '/w/response-workspace/settings/integrations',
        '/w/$workspaceSlug/integrations/linear',
        '/auth/login',
      ],
    });

    await waitFor(() =>
      expect(completeCallbackMock).toHaveBeenCalledWith({
        query: {code: 'grant-code-success', state: 'signed-state-success'},
        token: 'test-token',
      }),
    );
    expect(completeCallbackMock).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByTestId('route:/w/response-workspace/settings/integrations'),
      ).toBeInTheDocument(),
    );
    expect(window.sessionStorage.getItem(LINEAR_INSTALL_WORKSPACE_KEY)).toBeNull();
    expect(screen.getByText('Linear installed.')).toBeInTheDocument();
  });

  test('renders terminal conflicts without offering an ineffective restart', async () => {
    completeCallbackMock.mockRejectedValue(
      new ApiError({
        code: 'linear-installation-already-linked',
        message: 'already linked',
        status: 409,
      }),
    );

    renderCallback('?code=grant-code-conflict&state=signed-state-conflict');

    expect(await screen.findByRole('heading', {name: 'Linear already linked'})).toBeVisible();
    expect(screen.queryByRole('link', {name: 'Start over'})).not.toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Back to Shipfox'})).toBeVisible();
  });

  test('offers account switching and a fresh install after an actor mismatch', async () => {
    window.sessionStorage.setItem(LINEAR_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);
    completeCallbackMock.mockRejectedValue(
      new ApiError({
        code: 'linear-install-state-actor-mismatch',
        message: 'different account',
        status: 403,
      }),
    );

    renderCallback('?code=grant-code-account&state=signed-state-account');

    expect(await screen.findByRole('heading', {name: 'Different Shipfox account'})).toBeVisible();
    const switchAccountLink = screen.getByRole('link', {name: 'Switch account'});
    const switchAccountUrl = new URL(
      switchAccountLink.getAttribute('href') ?? '/',
      window.location.origin,
    );

    expect(switchAccountLink).toHaveAttribute(
      'href',
      `/auth/logout?redirect=${encodeURIComponent('/w/acme/integrations/linear')}`,
    );
    expect(switchAccountUrl.pathname).toBe('/auth/logout');
    expect(switchAccountUrl.searchParams.get('redirect')).toBe('/w/acme/integrations/linear');
    expect(screen.getByRole('link', {name: 'Start over'})).toBeVisible();
  });

  test('suppresses late success effects after the callback page unmounts', async () => {
    let resolveCallback!: (value: Record<string, unknown>) => void;
    const pendingCallback = new Promise<Record<string, unknown>>((resolve) => {
      resolveCallback = resolve;
    });
    window.sessionStorage.setItem(LINEAR_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);
    completeCallbackMock.mockReturnValue(pendingCallback);

    const callback = renderCallback('?code=grant-code-unmount&state=signed-state-unmount');
    await waitFor(() => expect(completeCallbackMock).toHaveBeenCalledTimes(1));
    callback.unmount();
    resolveCallback({workspace_id: INTEGRATIONS_TEST_WID});
    await pendingCallback;
    await Promise.resolve();

    expect(window.sessionStorage.getItem(LINEAR_INSTALL_WORKSPACE_KEY)).toBe(INTEGRATIONS_TEST_WID);
  });
});
