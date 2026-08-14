// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {configureApiClient} from '@shipfox/client-api';
import {screen, waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {SLACK_INSTALL_WORKSPACE_KEY} from '#slack-callback.js';
import {INTEGRATIONS_TEST_WID, renderIntegrationsPage, testWorkspace} from '#test/render.js';
import {SlackCallbackPage} from './slack-callback-page.js';

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
    useCompleteSlackCallbackMutation: () => ({mutateAsync: completeCallbackMock}),
  };
});

beforeEach(() => {
  window.sessionStorage.clear();
  completeCallbackMock.mockReset();
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: vi.fn((_input: RequestInfo | URL) =>
      Promise.reject(new Error('Workspace list unavailable')),
    ),
  });
});

describe('SlackCallbackPage', () => {
  test('completes a callback once in Strict Mode and navigates to its workspace', async () => {
    const responseWorkspaceId = '22222222-2222-4222-8222-222222222222';
    window.sessionStorage.setItem(SLACK_INSTALL_WORKSPACE_KEY, INTEGRATIONS_TEST_WID);
    completeCallbackMock.mockResolvedValue({
      id: 'connection-1',
      workspaceId: responseWorkspaceId,
      provider: 'slack',
      slug: 'slack_org',
      displayName: 'Slack org',
      capabilities: [],
    });

    renderIntegrationsPage({
      path: '/integrations/slack/callback?code=grant-code-success&state=signed-state-success',
      routePath: '/integrations/slack/callback',
      element: (
        <StrictMode>
          <SlackCallbackPage />
        </StrictMode>
      ),
      workspaces: [
        testWorkspace(),
        testWorkspace({id: responseWorkspaceId, slug: 'response-workspace'}),
      ],
      extraRoutes: [
        '/w/response-workspace/settings/integrations',
        '/w/$workspaceSlug/integrations/slack',
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
    expect(screen.getByText('Slack installed.')).toBeInTheDocument();
  });
});
