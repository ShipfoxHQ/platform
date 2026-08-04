// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {ApiError} from '@shipfox/client-api';
import {fireEvent, screen, waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {JIRA_INSTALL_WORKSPACE_KEY} from '#jira-callback.js';
import {resetJiraCallbackState} from '#jira-callback-state.js';
import {INTEGRATIONS_TEST_WID, renderIntegrationsPage, testWorkspace} from '#test/render.js';
import {JiraCallbackPage} from './jira-callback-page.js';

const {completeCallbackMock, completeSiteMock} = vi.hoisted(() => ({
  completeCallbackMock: vi.fn(),
  completeSiteMock: vi.fn(),
}));

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
    useCompleteJiraCallbackMutation: () => ({mutateAsync: completeCallbackMock}),
    useCompleteJiraSiteSelectionMutation: () => ({mutateAsync: completeSiteMock}),
  };
});

beforeEach(() => {
  window.sessionStorage.clear();
  resetJiraCallbackState();
  completeCallbackMock.mockReset();
  completeSiteMock.mockReset();
});

describe('JiraCallbackPage', () => {
  test('lists sites from the callback and completes the selected site', async () => {
    window.sessionStorage.setItem(JIRA_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);
    completeCallbackMock.mockResolvedValue({
      sites: [
        {
          cloudId: 'cloud-1',
          name: 'Acme',
          url: 'https://acme.atlassian.net',
          scopes: ['read:jira-work'],
        },
        {
          cloudId: 'cloud-2',
          name: 'Beta',
          url: 'https://beta.atlassian.net',
          scopes: ['read:jira-work'],
        },
      ],
    });
    completeSiteMock.mockResolvedValue({
      id: 'connection-1',
      workspaceId: INTEGRATIONS_TEST_WID,
      provider: 'jira',
      externalAccountId: 'cloud-1',
      slug: 'jira_acme',
      displayName: 'Jira Acme',
      lifecycleStatus: 'active',
      capabilities: ['agent_tools'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const rendered = renderIntegrationsPage({
      path: '/integrations/jira/callback?code=grant-code-jira&state=signed-state-jira',
      routePath: '/integrations/jira/callback',
      element: <JiraCallbackPage />,
      workspaces: [testWorkspace()],
      extraRoutes: [
        '/w/acme/settings/integrations',
        '/w/$workspaceSlug/integrations/jira',
        '/auth/login',
      ],
    });

    expect(await screen.findByRole('heading', {name: 'Choose a Jira site'})).toBeVisible();
    expect(screen.getByText('Acme')).toBeVisible();
    expect(screen.getByText('Beta')).toBeVisible();
    expect(completeCallbackMock).toHaveBeenCalledWith({
      query: {code: 'grant-code-jira', state: 'signed-state-jira'},
      token: 'test-token',
    });
    expect(completeCallbackMock).toHaveBeenCalledTimes(1);

    const connectButtons = screen.getAllByRole('button', {name: 'Connect'});
    expect(connectButtons).toHaveLength(2);
    fireEvent.click(connectButtons[0] as HTMLElement);

    await waitFor(() =>
      expect(completeSiteMock).toHaveBeenCalledWith({
        body: {cloud_id: 'cloud-1', state: 'signed-state-jira'},
        token: 'test-token',
      }),
    );
    await screen.findByTestId('route:/w/acme/settings/integrations');
    expect(completeSiteMock).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(JIRA_INSTALL_WORKSPACE_KEY)).toBeNull();
    expect(screen.getByText('Jira installed.')).toBeInTheDocument();

    rendered.unmount();
    renderIntegrationsPage({
      path: '/integrations/jira/callback?code=grant-code-jira&state=signed-state-jira',
      routePath: '/integrations/jira/callback',
      element: <JiraCallbackPage />,
      workspaces: [testWorkspace()],
      extraRoutes: [
        '/w/acme/settings/integrations',
        '/w/$workspaceSlug/integrations/jira',
        '/auth/login',
      ],
    });
    await waitFor(() => expect(completeCallbackMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', {name: 'Jira connected'})).toBeVisible();
  });

  test('completes a single-site callback in Strict Mode', async () => {
    window.sessionStorage.setItem(JIRA_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);
    completeCallbackMock.mockResolvedValue({
      id: 'connection-single',
      workspaceId: INTEGRATIONS_TEST_WID,
      provider: 'jira',
      externalAccountId: 'cloud-single',
      slug: 'jira_single',
      displayName: 'Jira Single',
      lifecycleStatus: 'active',
      capabilities: ['agent_tools'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    renderIntegrationsPage({
      path: '/integrations/jira/callback?code=grant-code-single&state=signed-state-single',
      routePath: '/integrations/jira/callback',
      element: (
        <StrictMode>
          <JiraCallbackPage />
        </StrictMode>
      ),
      workspaces: [testWorkspace()],
      extraRoutes: [
        '/w/acme/settings/integrations',
        '/w/$workspaceSlug/integrations/jira',
        '/auth/login',
      ],
    });

    await waitFor(() =>
      expect(completeCallbackMock).toHaveBeenCalledWith({
        query: {code: 'grant-code-single', state: 'signed-state-single'},
        token: 'test-token',
      }),
    );
    expect(completeCallbackMock).toHaveBeenCalledTimes(1);
    await screen.findByTestId('route:/w/acme/settings/integrations');
    expect(screen.getByText('Jira installed.')).toBeInTheDocument();
  });

  test('renders recovery without submitting an invalid callback', async () => {
    window.sessionStorage.setItem(JIRA_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);

    renderIntegrationsPage({
      path: '/integrations/jira/callback?state=missing-code',
      routePath: '/integrations/jira/callback',
      element: <JiraCallbackPage />,
      workspaces: [testWorkspace()],
      extraRoutes: [
        '/w/acme/settings/integrations',
        '/w/$workspaceSlug/integrations/jira',
        '/auth/login',
      ],
    });

    expect(
      await screen.findByRole('heading', {name: 'Jira install could not be completed'}),
    ).toBeVisible();
    expect(completeCallbackMock).not.toHaveBeenCalled();
    expect(screen.getByRole('link', {name: 'Start over'})).toBeVisible();
  });

  test('allows retrying a failed site selection', async () => {
    window.sessionStorage.setItem(JIRA_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);
    completeCallbackMock.mockResolvedValue({
      sites: [
        {
          cloudId: 'cloud-retry',
          name: 'Retry site',
          url: 'https://retry.atlassian.net',
          scopes: ['read:jira-work'],
        },
      ],
    });
    completeSiteMock
      .mockRejectedValueOnce(
        new ApiError({
          code: 'jira-pending-selection-not-found',
          message: 'selection expired',
          status: 404,
        }),
      )
      .mockResolvedValueOnce({
        id: 'connection-retry',
        workspaceId: INTEGRATIONS_TEST_WID,
        provider: 'jira',
        externalAccountId: 'cloud-retry',
        slug: 'jira_retry',
        displayName: 'Jira Retry',
        lifecycleStatus: 'active',
        capabilities: ['agent_tools'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

    renderIntegrationsPage({
      path: '/integrations/jira/callback?code=grant-code-retry&state=signed-state-retry',
      routePath: '/integrations/jira/callback',
      element: <JiraCallbackPage />,
      workspaces: [testWorkspace()],
      extraRoutes: [
        '/w/acme/settings/integrations',
        '/w/$workspaceSlug/integrations/jira',
        '/auth/login',
      ],
    });

    expect(await screen.findByRole('heading', {name: 'Choose a Jira site'})).toBeVisible();
    const connectButton = screen.getByRole('button', {name: 'Connect'});
    fireEvent.click(connectButton);

    await waitFor(() => expect(completeSiteMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'This Jira site selection is no longer valid. Start the install again from workspace settings.',
      );
    });
    await waitFor(() => expect(connectButton).not.toBeDisabled());

    fireEvent.click(connectButton);
    await waitFor(() => expect(completeSiteMock).toHaveBeenCalledTimes(2));
    await screen.findByTestId('route:/w/acme/settings/integrations');
    expect(screen.getByText('Jira installed.')).toBeInTheDocument();
  });
});
