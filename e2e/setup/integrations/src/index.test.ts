import {beforeEach, describe, expect, it, vi} from '@shipfox/vitest/vi';

const requestJson = vi.fn();
const request = vi.fn();

describe('integrations E2E setup helper', () => {
  beforeEach(() => {
    vi.resetModules();
    requestJson.mockReset();
    request.mockReset();
    vi.doMock('@shipfox/e2e-core', () => ({request, requestJson}));
  });

  it('creates Linear connections through the protected setup route', async () => {
    requestJson.mockResolvedValueOnce({id: 'connection-id'});
    const {createLinearConnection} = await import('./index.js');

    await createLinearConnection({
      workspaceId: 'workspace-id',
      organizationId: 'linear-org',
      organizationUrlKey: 'acme',
      appUserId: 'linear-app-user',
      displayName: 'Linear Acme',
      accessToken: 'linear-e2e-token',
      scopes: ['read', 'write'],
    });

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/integrations/linear-connections', {
      json: {
        workspace_id: 'workspace-id',
        organization_id: 'linear-org',
        organization_url_key: 'acme',
        app_user_id: 'linear-app-user',
        display_name: 'Linear Acme',
        access_token: 'linear-e2e-token',
        scopes: ['read', 'write'],
      },
    });
  });

  it('creates GitHub connections through the protected setup route', async () => {
    requestJson.mockResolvedValueOnce({id: 'connection-id'});
    const {createGithubConnection} = await import('./index.js');

    await createGithubConnection({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      installationId: 1234,
      accountLogin: 'shipfox-e2e',
      displayName: 'GitHub Shipfox E2E',
      installerUserId: '00000000-0000-4000-8000-000000000002',
    });

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/integrations/github-connections', {
      json: {
        workspace_id: '00000000-0000-4000-8000-000000000001',
        installation_id: 1234,
        account_login: 'shipfox-e2e',
        display_name: 'GitHub Shipfox E2E',
        installer_user_id: '00000000-0000-4000-8000-000000000002',
      },
    });
  });

  it('can create a disabled GitHub connection for setup sequencing', async () => {
    requestJson.mockResolvedValueOnce({id: 'connection-id'});
    const {createGithubConnection} = await import('./index.js');

    await createGithubConnection({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      installationId: 1234,
      accountLogin: 'shipfox-e2e',
      displayName: 'GitHub Shipfox E2E',
      installerUserId: '00000000-0000-4000-8000-000000000002',
      lifecycleStatus: 'disabled',
    });

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/integrations/github-connections', {
      json: {
        workspace_id: '00000000-0000-4000-8000-000000000001',
        installation_id: 1234,
        account_login: 'shipfox-e2e',
        display_name: 'GitHub Shipfox E2E',
        installer_user_id: '00000000-0000-4000-8000-000000000002',
        lifecycle_status: 'disabled',
      },
    });
  });

  it('creates Test VCS connections and repositories through the protected setup routes', async () => {
    requestJson.mockResolvedValueOnce({id: 'connection-id'}).mockResolvedValueOnce({
      external_repository_id: 'test-vcs:e2e-owner/repository',
    });
    const {createTestVcsConnection, createTestVcsRepository, testVcsExternalRepositoryId} =
      await import('./index.js');

    await createTestVcsConnection({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      accountId: 'e2e-owner',
      renewalMode: 'refresh-at',
      refreshAfterSeconds: 1,
    });
    await createTestVcsRepository({
      connectionId: 'connection-id',
      name: 'repository',
      files: [{path: 'README.md', content: '# E2E'}],
    });

    expect(requestJson).toHaveBeenNthCalledWith(
      1,
      'post',
      '/__e2e/integrations/test-vcs/connections',
      {
        json: {
          workspace_id: '00000000-0000-4000-8000-000000000001',
          account_id: 'e2e-owner',
          renewal_mode: 'refresh-at',
          refresh_after_seconds: 1,
        },
      },
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      2,
      'post',
      '/__e2e/integrations/test-vcs/repositories',
      {
        json: {
          connection_id: 'connection-id',
          name: 'repository',
          files: [{path: 'README.md', content: '# E2E'}],
        },
      },
    );
    expect(testVcsExternalRepositoryId('e2e-owner', 'repository')).toBe(
      'test-vcs:e2e-owner/repository',
    );
  });

  it('records Test VCS fixture observations and can fail credential mints', async () => {
    request.mockResolvedValueOnce(new Response(null, {status: 204}));
    requestJson.mockResolvedValueOnce({
      mint_count: 2,
      request_count: 3,
      accepted_request_count: 2,
      rejected_request_count: 1,
      generations: ['generation-a', 'generation-b'],
      invalidations: [],
      requests: [],
    });
    const {failNextTestVcsMints, getTestVcsStats} = await import('./index.js');

    await failNextTestVcsMints(2);
    const stats = await getTestVcsStats({connectionId: '00000000-0000-4000-8000-000000000003'});

    expect(request).toHaveBeenCalledWith('post', '/__e2e/integrations/test-vcs/fail-next-mints', {
      json: {count: 2},
    });
    expect(requestJson).toHaveBeenCalledWith(
      'get',
      '/__e2e/integrations/test-vcs/stats?connection_id=00000000-0000-4000-8000-000000000003',
      {},
    );
    expect(stats.generations).toEqual(['generation-a', 'generation-b']);
  });
});
