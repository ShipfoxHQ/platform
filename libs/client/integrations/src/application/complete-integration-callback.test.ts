import {QueryClient} from '@tanstack/react-query';
import type {IntegrationConnection} from '#core/models.js';
import {integrationsQueryKeys} from '#hooks/api/integrations.js';
import {
  completeIntegrationCallback,
  completeIntegrationCallbackResult,
} from './complete-integration-callback.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

const connection: IntegrationConnection = {
  id: '22222222-2222-4222-8222-222222222222',
  workspaceId: WORKSPACE_ID,
  provider: 'github',
  externalAccountId: 'account',
  slug: 'github-account',
  displayName: 'GitHub',
  lifecycleStatus: 'active',
  capabilities: ['source_control'],
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
};

describe('completeIntegrationCallback', () => {
  test('invalidates the workspace connection views after callback completion', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const refreshAuth = vi.fn().mockResolvedValue({accessToken: 'access-token'});
    const complete = vi.fn().mockResolvedValue(connection);

    const result = await completeIntegrationCallback({
      input: {code: 'grant-code'},
      refreshAuth,
      complete,
      queryClient,
    });

    expect(result).toBe(connection);
    expect(complete).toHaveBeenCalledWith({code: 'grant-code'}, 'access-token');
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: integrationsQueryKeys.connectionsByWorkspace(WORKSPACE_ID),
    });
  });

  test('does not invalidate a connection view for a result without a connection', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const refreshAuth = vi.fn().mockResolvedValue({accessToken: 'access-token'});
    const complete = vi.fn().mockResolvedValue({sites: []});

    const result = await completeIntegrationCallbackResult({
      input: {code: 'grant-code'},
      refreshAuth,
      complete,
      getConnection: () => undefined,
      queryClient,
    });

    expect(result).toEqual({sites: []});
    expect(complete).toHaveBeenCalledWith({code: 'grant-code'}, 'access-token');
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  test('invalidates a connection view for a result with a connection', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const refreshAuth = vi.fn().mockResolvedValue({accessToken: 'access-token'});
    const complete = vi.fn(async () => connection);

    const result = await completeIntegrationCallbackResult({
      input: {code: 'grant-code'},
      refreshAuth,
      complete,
      getConnection: (value) => value,
      queryClient,
    });

    expect(result).toBe(connection);
    expect(complete).toHaveBeenCalledWith({code: 'grant-code'}, 'access-token');
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: integrationsQueryKeys.connectionsByWorkspace(WORKSPACE_ID),
    });
  });
});
