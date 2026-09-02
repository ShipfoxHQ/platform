import type {IntegrationConnectionDto} from '@shipfox/api-integration-core-dto';
import {configureApiClient} from '@shipfox/client-api';
import {
  completeJiraCallback,
  completeJiraSiteSelection,
  completeLinearCallback,
  completeSlackCallback,
  createJiraInstall,
  createLinearInstall,
  createSlackInstall,
  listIntegrationConnectionRepositoryAccess,
  listSourceConnections,
  updateIntegrationConnectionRepositoryAccess,
} from './integrations.js';

function connection(overrides: Partial<IntegrationConnectionDto> = {}): IntegrationConnectionDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workspace_id: '22222222-2222-4222-8222-222222222222',
    provider: 'github',
    external_account_id: 'acct',
    slug: 'github_acct',
    display_name: 'GitHub',
    lifecycle_status: 'active',
    capabilities: ['source_control'],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
}

describe('listSourceConnections', () => {
  test('requests the source_control capability and drops non-active connections', async () => {
    let requestedUrl = '';
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      if (typeof input === 'string') requestedUrl = input;
      else if (input instanceof URL) requestedUrl = input.href;
      else requestedUrl = input.url;
      return Promise.resolve(
        jsonResponse({
          connections: [
            connection({id: '33333333-3333-4333-8333-333333333333', lifecycle_status: 'active'}),
            connection({id: '44444444-4444-4444-8444-444444444444', lifecycle_status: 'disabled'}),
            connection({id: '55555555-5555-4555-8555-555555555555', lifecycle_status: 'error'}),
          ],
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const result = await listSourceConnections({
      workspaceId: '22222222-2222-4222-8222-222222222222',
    });

    expect(requestedUrl).toContain('capability=source_control');
    expect(result.map((connection) => connection.id)).toEqual([
      '33333333-3333-4333-8333-333333333333',
    ]);
  });
});

describe('repository access transport', () => {
  test('loads and maps the composed repository access read model', async () => {
    let requestedUrl = '';
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      requestedUrl = input instanceof Request ? input.url : String(input);
      return Promise.resolve(
        jsonResponse({
          mode: 'selected',
          repositories: [
            {
              external_repository_id: 'acme/platform',
              owner: 'acme',
              name: 'platform',
              origins: [
                {
                  type: 'project',
                  project_id: '33333333-3333-4333-8333-333333333333',
                  project_name: 'Platform',
                },
                {type: 'manual', grant_id: '44444444-4444-4444-8444-444444444444'},
              ],
            },
          ],
          next_cursor: null,
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const result = await listIntegrationConnectionRepositoryAccess({
      connectionId: '11111111-1111-4111-8111-111111111111',
      cursor: 'next-page',
    });

    expect(requestedUrl).toBe(
      'https://api.example.test/integration-connections/11111111-1111-4111-8111-111111111111/repository-access?cursor=next-page',
    );
    expect(result).toEqual({
      mode: 'selected',
      repositories: [
        {
          externalRepositoryId: 'acme/platform',
          owner: 'acme',
          name: 'platform',
          origins: [
            {
              type: 'project',
              projectId: '33333333-3333-4333-8333-333333333333',
              projectName: 'Platform',
            },
            {type: 'manual', grantId: '44444444-4444-4444-8444-444444444444'},
          ],
        },
      ],
    });
  });

  test('updates repository access mode through the idempotent route', async () => {
    const requests: Request[] = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      return Promise.resolve(jsonResponse({mode: 'all'}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const mode = await updateIntegrationConnectionRepositoryAccess({
      connectionId: '11111111-1111-4111-8111-111111111111',
      mode: 'all',
    });

    expect(mode).toBe('all');
    expect(requests[0]?.method).toBe('PUT');
    expect(requests[0]?.url).toBe(
      'https://api.example.test/integration-connections/11111111-1111-4111-8111-111111111111/repository-access',
    );
    expect(await requests[0]?.json()).toEqual({mode: 'all'});
  });
});

describe('Slack transport', () => {
  it('posts the install workspace and forwards an authenticated callback query', async () => {
    const requests: Request[] = [];
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn((input, init) => {
        requests.push(new Request(input, init));
        const url = input instanceof Request ? input.url : String(input);
        return Promise.resolve(
          jsonResponse(
            url.endsWith('/install')
              ? {install_url: 'https://slack.example.test/install'}
              : connection({provider: 'slack'}),
          ),
        );
      }),
    });

    const install = await createSlackInstall({
      workspace_id: '11111111-1111-4111-8111-111111111111',
    });
    await completeSlackCallback({
      query: {code: 'grant code', state: 'signed state'},
      token: 'session-token',
    });

    expect(requests[0]?.url).toBe('https://api.example.test/integrations/slack/install');
    expect(await requests[0]?.json()).toEqual({
      workspace_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(install).toEqual({installUrl: 'https://slack.example.test/install'});
    expect(requests[1]?.url).toBe(
      'https://api.example.test/integrations/slack/callback/api?code=grant+code&state=signed+state',
    );
    expect(requests[1]?.headers.get('authorization')).toBe('Bearer session-token');
  });
});

describe('Linear transport', () => {
  it('posts the install workspace and forwards an authenticated callback query', async () => {
    const requests: Request[] = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      const url = input instanceof Request ? input.url : String(input);
      return Promise.resolve(
        jsonResponse(
          url.endsWith('/install')
            ? {install_url: 'https://linear.example.test/install'}
            : {
                id: '33333333-3333-4333-8333-333333333333',
                workspace_id: '11111111-1111-4111-8111-111111111111',
                provider: 'linear',
                external_account_id: 'linear-org',
                slug: 'linear_org',
                display_name: 'Linear org',
                lifecycle_status: 'active',
                capabilities: [],
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
              },
        ),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const install = await createLinearInstall({
      workspace_id: '11111111-1111-4111-8111-111111111111',
    });
    await completeLinearCallback({
      query: {code: 'grant code', state: 'signed state'},
      token: 'session-token',
    });
    await completeLinearCallback({
      query: {
        error: 'access_denied',
        error_description: 'User denied access',
        state: 'signed error state',
      },
      token: 'session-token',
    });

    expect(requests[0]?.url).toBe('https://api.example.test/integrations/linear/install');
    expect(await requests[0]?.json()).toEqual({
      workspace_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(install).toEqual({installUrl: 'https://linear.example.test/install'});
    expect(requests[1]?.url).toBe(
      'https://api.example.test/integrations/linear/callback/api?code=grant+code&state=signed+state',
    );
    expect(requests[1]?.headers.get('authorization')).toBe('Bearer session-token');
    expect(requests[2]?.url).toBe(
      'https://api.example.test/integrations/linear/callback/api?error=access_denied&error_description=User+denied+access&state=signed+error+state',
    );
  });
});

describe('Jira transport', () => {
  it('posts the install workspace, maps multi-site callbacks, and completes a site selection', async () => {
    const requests: Request[] = [];
    const connectionBody = {
      id: '33333333-3333-4333-8333-333333333333',
      workspace_id: '11111111-1111-4111-8111-111111111111',
      provider: 'jira',
      external_account_id: 'cloud-1',
      slug: 'jira_acme',
      display_name: 'Jira Acme',
      lifecycle_status: 'active',
      capabilities: ['agent_tools'],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn((input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.endsWith('/install'))
          return Promise.resolve(jsonResponse({install_url: 'https://jira.example.test/install'}));
        if (request.url.endsWith('/callback/site'))
          return Promise.resolve(jsonResponse(connectionBody));
        return Promise.resolve(
          jsonResponse({
            sites: [
              {
                cloud_id: 'cloud-1',
                name: 'Acme',
                url: 'https://acme.atlassian.net',
                scopes: ['read:jira-work'],
              },
              {
                cloud_id: 'cloud-2',
                name: 'Beta',
                url: 'https://beta.atlassian.net',
                scopes: ['read:jira-work'],
              },
            ],
          }),
        );
      }),
    });

    const install = await createJiraInstall({
      workspace_id: '11111111-1111-4111-8111-111111111111',
    });
    const sites = await completeJiraCallback({
      query: {code: 'grant code', state: 'signed state'},
      token: 'session-token',
    });
    const connection = await completeJiraSiteSelection({
      body: {cloud_id: 'cloud-1', state: 'signed state'},
      token: 'session-token',
    });

    expect(install).toEqual({installUrl: 'https://jira.example.test/install'});
    expect(sites).toEqual({
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
    expect(connection.provider).toBe('jira');
    expect(requests[0]?.url).toBe('https://api.example.test/integrations/jira/install');
    expect(await requests[0]?.json()).toEqual({
      workspace_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(requests[1]?.url).toBe(
      'https://api.example.test/integrations/jira/callback/api?code=grant+code&state=signed+state',
    );
    expect(requests[1]?.headers.get('authorization')).toBe('Bearer session-token');
    expect(requests[2]?.url).toBe('https://api.example.test/integrations/jira/callback/site');
    expect(await requests[2]?.json()).toEqual({cloud_id: 'cloud-1', state: 'signed state'});
    expect(requests[2]?.headers.get('authorization')).toBe('Bearer session-token');
  });
});
