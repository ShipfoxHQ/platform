import {ApiError, apiRequest, configureApiClient, getErrorCode, isErrorWithCode} from './index.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

describe('apiRequest', () => {
  beforeEach(() => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: undefined,
      getAccessToken: undefined,
      refreshAccessToken: undefined,
    });
  });

  test('preserves the native fetch receiver', async () => {
    const originalFetch = globalThis.fetch;
    let receiver: unknown;
    globalThis.fetch = vi.fn(function (this: unknown) {
      receiver = this;
      return Promise.resolve(jsonResponse({ok: true}));
    }) as typeof fetch;

    try {
      const result = await apiRequest<{ok: boolean}>('/auth/refresh', {method: 'POST'});

      expect(result.ok).toBe(true);
      expect(receiver).toBe(globalThis);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('sends credentials and bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ok: true}));
    configureApiClient({fetchImpl, getAccessToken: () => 'access-token'});

    const result = await apiRequest<{ok: boolean}>('/auth/refresh', {method: 'POST'});

    expect(result.ok).toBe(true);
    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe('https://api.example.test/auth/refresh');
    expect(request.credentials).toBe('include');
    expect(request.method).toBe('POST');
    expect(request.headers.get('authorization')).toBe('Bearer access-token');
  });

  test('normalizes json API errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({message: 'Invalid credentials', code: 'invalid-credentials'}, {status: 401}),
      );
    configureApiClient({fetchImpl});

    const result = apiRequest('/auth/login', {method: 'POST'});

    await expect(result).rejects.toMatchObject({
      code: 'invalid-credentials',
      message: 'Invalid credentials',
      status: 401,
    });
  });

  test('refreshes and retries authenticated 401s once', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({message: 'Unauthorized', code: 'unauthorized'}, {status: 401}),
      )
      .mockResolvedValueOnce(jsonResponse({ok: true}));
    const refreshAccessToken = vi.fn().mockResolvedValue('fresh-token');
    configureApiClient({
      fetchImpl,
      getAccessToken: () => 'expired-token',
      refreshAccessToken,
    });

    const result = await apiRequest<{ok: boolean}>('/workspaces');

    expect(result.ok).toBe(true);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    const firstRequest = fetchImpl.mock.calls[0]?.[0] as Request;
    const secondRequest = fetchImpl.mock.calls[1]?.[0] as Request;
    expect(firstRequest.headers.get('authorization')).toBe('Bearer expired-token');
    expect(secondRequest.headers.get('authorization')).toBe('Bearer fresh-token');
  });

  test('does not refresh unauthenticated 401s', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({message: 'Invalid credentials', code: 'invalid-credentials'}, {status: 401}),
      );
    const refreshAccessToken = vi.fn().mockResolvedValue('fresh-token');
    configureApiClient({fetchImpl, refreshAccessToken});

    const result = apiRequest('/auth/login', {method: 'POST'});

    await expect(result).rejects.toMatchObject({
      code: 'invalid-credentials',
      status: 401,
    });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  test('normalizes network failures', async () => {
    configureApiClient({fetchImpl: vi.fn().mockRejectedValue(new Error('offline'))});

    const result = apiRequest('/auth/login', {method: 'POST'});

    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({code: 'network-error', status: 0});
  });

  test('matches error codes', () => {
    const error = new ApiError({message: 'Nope', code: 'nope', status: 400});

    const code = getErrorCode(error);
    const matches = isErrorWithCode(error, 'nope');

    expect(code).toBe('nope');
    expect(matches).toBe(true);
  });
});
