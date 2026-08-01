import {configureApiClient} from '@shipfox/client-api';
import {userWorkspacesQueryKey} from '@shipfox/client-shell/runtime';
import {QueryClient} from '@tanstack/react-query';
import {resolveWorkspaceSlug} from './workspace-navigation.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

describe('resolveWorkspaceSlug', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('uses refreshed cached memberships when the follow-up list request fails', async () => {
    configureApiClient({
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            {code: 'server-error', message: 'Workspace list unavailable'},
            {status: 500},
          ),
        ),
    });
    const queryClient = new QueryClient();
    queryClient.setQueryData(userWorkspacesQueryKey, {
      memberships: [{id: 'response-workspace', slug: 'response-workspace'}],
    });

    await expect(
      resolveWorkspaceSlug({
        workspaceId: 'response-workspace',
        fallbackWorkspaces: [{id: 'response-workspace', slug: 'old-slug'}],
        queryClient,
      }),
    ).resolves.toBe('response-workspace');
  });
});
