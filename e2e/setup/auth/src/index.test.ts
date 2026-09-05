const userId = '11111111-1111-4111-8111-111111111111';
const refreshCookie = 'shipfox_refresh=refresh-token; Path=/auth/refresh; HttpOnly; SameSite=Lax';
const BROWSER_E2E_STATE_RE = /^browser-e2e-/u;
const agentAccessWorkspaceId = '33333333-3333-4333-8333-333333333333';
const agentAccessRequestId = '22222222-2222-4222-8222-222222222222';
const agentAccessRedirectUri = 'http://127.0.0.1:43124/oauth/callback';

function response(params: {setCookie?: string; json: unknown}) {
  return {
    headers: {
      get: vi.fn((name: string) => (name.toLowerCase() === 'set-cookie' ? params.setCookie : null)),
    },
    json: vi.fn().mockResolvedValue(params.json),
  };
}

function apiResponse(params: {status: number; json?: unknown; headers?: Record<string, string>}) {
  return {
    status: vi.fn(() => params.status),
    headers: vi.fn(() => params.headers ?? {}),
    json: vi.fn().mockResolvedValue(params.json),
  };
}

function agentAccessFlow(overrides?: {
  consentClientName?: string;
  consentWorkspaceId?: string;
  approvalRedirect?: (state: string) => string;
}) {
  let authorizationState = '';
  const post = vi.fn((url: string, options: {data?: unknown}) => {
    if (url.endsWith('/oauth/register')) {
      return apiResponse({
        status: 201,
        json: {
          client_id: 'client-id',
          client_name: 'Test client',
          redirect_uris: [agentAccessRedirectUri],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: 'read',
        },
      });
    }
    if (url.endsWith('/approve')) {
      expect(options.data).toEqual({workspace_id: agentAccessWorkspaceId});
      return apiResponse({
        status: 200,
        json: {
          redirect_url:
            overrides?.approvalRedirect?.(authorizationState) ??
            `${agentAccessRedirectUri}?code=authorization-code&state=${authorizationState}`,
        },
      });
    }
    expect(String(options.data)).toContain('code=authorization-code');
    return apiResponse({
      status: 200,
      json: {
        access_token: 'access-token',
        token_type: 'Bearer',
        expires_in: 300,
        refresh_token: 'refresh-token',
        scope: 'read',
      },
    });
  });
  const get = vi.fn((url: string, _options?: unknown) => {
    if (url.includes('/oauth/authorize')) {
      authorizationState = new URL(url).searchParams.get('state') ?? '';
      return apiResponse({
        status: 302,
        headers: {
          location: `https://client.example.test/oauth/consent?request_id=${agentAccessRequestId}`,
        },
      });
    }
    return apiResponse({
      status: 200,
      json: {
        request_id: agentAccessRequestId,
        client_name: overrides?.consentClientName ?? 'Test client',
        scope: 'read',
        expires_at: '2026-09-05T12:00:00.000Z',
        redirect_uri_hostname: '127.0.0.1',
        client_identity_origin: 'http://127.0.0.1:43124',
        is_loopback_redirect: true,
        workspaces: [
          {
            workspace_id: overrides?.consentWorkspaceId ?? agentAccessWorkspaceId,
            role: 'owner',
          },
        ],
      },
    });
  });
  return {get, post, request: {get, post} as never};
}

function agentAccessAuthorizationOptions(request: never) {
  return {
    request,
    apiOrigin: 'https://api.example.test',
    publicOrigin: 'https://public-api.example.test',
    clientName: 'Test client',
    redirectUri: agentAccessRedirectUri,
    statePrefix: 'browser-e2e',
    sessionToken: 'session-token',
    workspaceId: agentAccessWorkspaceId,
  };
}

describe('auth setup helper', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('posts generated users to the auth E2E setup route', async () => {
    const requestJson = vi.fn().mockResolvedValue({
      user: {id: userId},
      email: 'user@example.test',
      password: 'secret-password',
    });
    vi.doMock('@shipfox/e2e-core', () => ({config: {}, request: vi.fn(), requestJson}));
    const {createUser} = await import('./index.js');

    const result = await createUser({
      email: 'user@example.test',
      password: 'secret-password',
      name: 'E2E User',
      verified: false,
    });

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/auth/users', {
      json: {
        email: 'user@example.test',
        password: 'secret-password',
        name: 'E2E User',
        verified: false,
      },
    });
    expect(result.user.id).toBe(userId);
  });

  test('returns the session token with the refresh cookie', async () => {
    const request = vi.fn().mockResolvedValue(
      response({
        setCookie: refreshCookie,
        json: {token: 'session-token', expires_at: '2026-01-15T12:00:00.000Z'},
      }),
    );
    vi.doMock('@shipfox/e2e-core', () => ({config: {}, request, requestJson: vi.fn()}));
    const {createSession} = await import('./index.js');

    const result = await createSession({user_id: userId});

    expect(request).toHaveBeenCalledWith('post', '/__e2e/auth/sessions', {
      json: {user_id: userId},
    });
    expect(result).toEqual({
      token: 'session-token',
      expires_at: '2026-01-15T12:00:00.000Z',
      setCookie: refreshCookie,
    });
  });

  test('fails when the session response omits the refresh cookie', async () => {
    const request = vi.fn().mockResolvedValue(response({json: {token: 'session-token'}}));
    vi.doMock('@shipfox/e2e-core', () => ({config: {}, request, requestJson: vi.fn()}));
    const {createSession} = await import('./index.js');

    const result = createSession({user_id: userId});

    await expect(result).rejects.toThrow('E2E session endpoint did not set a refresh cookie');
  });

  test('hydrates the browser refresh cookie when logging in', async () => {
    const addCookies = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue(
      response({
        setCookie: refreshCookie,
        json: {token: 'session-token', expires_at: '2026-01-15T12:00:00.000Z'},
      }),
    );
    vi.doMock('@shipfox/e2e-core', () => ({
      config: {API_URL: 'https://api.example.test'},
      request,
      requestJson: vi.fn(),
    }));
    const {loginAs} = await import('./index.js');

    await loginAs({context: () => ({addCookies})} as never, {user: {id: userId}} as never);

    expect(addCookies).toHaveBeenCalledWith([
      {
        name: 'shipfox_refresh',
        value: 'refresh-token',
        domain: 'api.example.test',
        path: '/auth/refresh',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
  });

  test('registers a validated OAuth client and starts its consent request', async () => {
    const redirectUri = 'http://127.0.0.1:43124/oauth/callback';
    const requestId = '22222222-2222-4222-8222-222222222222';
    const post = vi.fn().mockResolvedValue(
      apiResponse({
        status: 201,
        json: {
          client_id: 'client-id',
          client_name: 'Test client',
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: 'read',
        },
      }),
    );
    const get = vi.fn().mockResolvedValue(
      apiResponse({
        status: 302,
        headers: {location: `http://client.example.test/oauth/consent?request_id=${requestId}`},
      }),
    );
    vi.doMock('@shipfox/e2e-core', () => ({config: {}, request: vi.fn(), requestJson: vi.fn()}));
    const {requestAgentAccessConsent} = await import('./index.js');

    const result = await requestAgentAccessConsent({
      request: {post, get} as never,
      apiOrigin: 'https://api.example.test',
      publicOrigin: 'https://public-api.example.test',
      clientName: 'Test client',
      redirectUri,
      statePrefix: 'browser-e2e',
    });

    expect(post).toHaveBeenCalledWith('https://api.example.test/oauth/register', {
      data: {
        client_name: 'Test client',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'read',
      },
      failOnStatusCode: false,
    });
    const authorizationUrl = new URL(String(get.mock.calls[0]?.[0]));
    expect(authorizationUrl.origin).toBe('https://api.example.test');
    expect(authorizationUrl.pathname).toBe('/oauth/authorize');
    expect(authorizationUrl.searchParams.get('client_id')).toBe('client-id');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('code_challenge')).toHaveLength(43);
    expect(authorizationUrl.searchParams.get('resource')).toBe(
      'https://public-api.example.test/mcp',
    );
    expect(get.mock.calls[0]?.[1]).toEqual({failOnStatusCode: false, maxRedirects: 0});
    expect(result).toEqual({
      clientId: 'client-id',
      codeVerifier: expect.any(String),
      requestId,
      state: expect.stringMatching(BROWSER_E2E_STATE_RE),
    });
  });

  test('approves a consent request and exchanges its authorization code', async () => {
    const flow = agentAccessFlow();
    vi.doMock('@shipfox/e2e-core', () => ({config: {}, request: vi.fn(), requestJson: vi.fn()}));
    const {authorizeAgentAccess} = await import('./index.js');

    const result = await authorizeAgentAccess(agentAccessAuthorizationOptions(flow.request));

    expect(result).toEqual({
      access_token: 'access-token',
      token_type: 'Bearer',
      expires_in: 300,
      refresh_token: 'refresh-token',
      scope: 'read',
    });
    expect(flow.post).toHaveBeenCalledTimes(3);
    expect(flow.get).toHaveBeenCalledTimes(2);
    expect(flow.get.mock.calls[1]?.[1]).toMatchObject({failOnStatusCode: false});
    expect(flow.post.mock.calls[1]?.[1]).toMatchObject({failOnStatusCode: false});
    expect(flow.post.mock.calls[2]?.[1]).toMatchObject({failOnStatusCode: false});
  });

  test.each([
    {consentClientName: 'Another client'},
    {consentWorkspaceId: '44444444-4444-4444-8444-444444444444'},
  ])('rejects consent details that do not match the requested client and workspace', async (override) => {
    const flow = agentAccessFlow(override);
    vi.doMock('@shipfox/e2e-core', () => ({config: {}, request: vi.fn(), requestJson: vi.fn()}));
    const {authorizeAgentAccess} = await import('./index.js');

    const result = authorizeAgentAccess(agentAccessAuthorizationOptions(flow.request));

    await expect(result).rejects.toThrow(
      'OAuth consent detail did not match the requested loopback client and workspace',
    );
    expect(flow.post).toHaveBeenCalledTimes(1);
  });

  test.each([
    {
      approvalRedirect: (state: string) =>
        `http://localhost:43124/oauth/callback?code=authorization-code&state=${state}`,
    },
    {
      approvalRedirect: () =>
        `${agentAccessRedirectUri}?code=authorization-code&state=another-state`,
    },
  ])('rejects approval redirects that change the registered origin or state', async (override) => {
    const flow = agentAccessFlow(override);
    vi.doMock('@shipfox/e2e-core', () => ({config: {}, request: vi.fn(), requestJson: vi.fn()}));
    const {authorizeAgentAccess} = await import('./index.js');

    const result = authorizeAgentAccess(agentAccessAuthorizationOptions(flow.request));

    await expect(result).rejects.toThrow(
      'OAuth consent approval returned an invalid client redirect',
    );
    expect(flow.post).toHaveBeenCalledTimes(2);
  });
});
