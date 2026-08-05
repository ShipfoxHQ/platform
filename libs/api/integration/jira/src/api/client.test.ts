import {HTTPError} from 'ky';
import type {JiraIntegrationProviderError} from '#core/errors.js';
import {mapJiraError} from './client.js';

const mocks = vi.hoisted(() => ({
  delete: vi.fn(),
  post: vi.fn(),
  request: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => ({
    warn: mocks.warn,
  }),
}));

vi.mock('ky', () => {
  class MockHTTPError extends Error {
    data?: unknown;

    constructor(public response: Response) {
      super('http');
      this.name = 'HTTPError';
    }
  }
  class MockTimeoutError extends Error {
    constructor() {
      super('timeout');
      this.name = 'TimeoutError';
    }
  }
  return {
    default: Object.assign(mocks.request, {delete: mocks.delete, post: mocks.post}),
    HTTPError: MockHTTPError,
    TimeoutError: MockTimeoutError,
  };
});

function rejectedRequest(status: number, body?: {error: string}): () => Promise<never> {
  return async () => {
    const response = new Response(body ? JSON.stringify(body) : null, {
      status,
      ...(body ? {headers: {'content-type': 'application/json'}} : {}),
    });
    const error = new HTTPError(response, new Request('https://jira.example.test'), {} as never);
    await response.text();
    error.data = body;
    throw error;
  };
}

describe('mapJiraError', () => {
  it.each([
    [401, 'access-denied'],
    [403, 'access-denied'],
    [400, 'malformed-provider-response'],
    [404, 'malformed-provider-response'],
  ] as const)('maps HTTP %i to %s', async (status, reason) => {
    const result = mapJiraError('test', rejectedRequest(status));

    await expect(result).rejects.toMatchObject({
      reason,
    } satisfies Partial<JiraIntegrationProviderError>);
  });

  it.each([
    ['invalid_grant', 'access-denied'],
    ['unauthorized_client', 'access-denied'],
    ['invalid_request', 'malformed-provider-response'],
    [undefined, 'malformed-provider-response'],
  ] as const)('maps refresh HTTP 400 with OAuth error %s to %s', async (errorCode, reason) => {
    const result = mapJiraError(
      'refresh-access-token',
      rejectedRequest(400, errorCode ? {error: errorCode} : undefined),
    );

    await expect(result).rejects.toMatchObject({reason});
  });
});

function resolves(data: unknown) {
  return {json: () => Promise.resolve(data)};
}

describe('Jira dynamic webhook API', () => {
  beforeEach(() => {
    mocks.delete.mockReset();
    mocks.post.mockReset();
    mocks.request.mockReset();
    mocks.warn.mockReset();
  });

  it('registers the six curated events with the access token', async () => {
    mocks.post.mockReturnValue(
      resolves({webhookRegistrationResult: [{createdWebhookId: 123, errors: []}]}),
    );

    const {createJiraApiClient} = await import('./client.js');
    const result = await createJiraApiClient().registerDynamicWebhook({
      accessToken: 'access-token',
      cloudId: 'cloud-1',
      url: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
    });

    const [url, options] = mocks.post.mock.calls[0] as [
      string,
      {headers: Record<string, string>; json: Record<string, unknown>},
    ];
    expect(url).toBe('http://127.0.0.1:0/ex/jira/cloud-1/rest/api/3/webhook');
    expect(options.headers).toEqual({authorization: 'Bearer access-token'});
    expect(options.json).toEqual({
      url: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
      webhooks: [
        {
          events: [
            'jira:issue_created',
            'jira:issue_updated',
            'jira:issue_deleted',
            'comment_created',
            'comment_updated',
            'comment_deleted',
          ],
          jqlFilter: '',
        },
      ],
    });
    expect(result).toEqual({webhookId: 123});
  });

  it.each([
    {webhookRegistrationResult: []},
    {webhookRegistrationResult: [{createdWebhookId: 123, errors: ['rejected']}]},
    {webhookRegistrationResult: [{errors: []}]},
  ])('rejects malformed or errored registration responses', async (response) => {
    mocks.post.mockReturnValue(resolves(response));
    const {createJiraApiClient} = await import('./client.js');

    await expect(
      createJiraApiClient().registerDynamicWebhook({
        accessToken: 'access-token',
        cloudId: 'cloud-1',
        url: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
      }),
    ).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('logs provider validation errors before rejecting registration', async () => {
    mocks.post.mockReturnValue(
      resolves({
        webhookRegistrationResult: [
          {createdWebhookId: 123, errors: ['Webhook URL is not approved', 'Invalid JQL filter']},
        ],
      }),
    );
    const {createJiraApiClient} = await import('./client.js');

    await expect(
      createJiraApiClient().registerDynamicWebhook({
        accessToken: 'access-token',
        cloudId: 'cloud-1',
        url: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
      }),
    ).rejects.toMatchObject({reason: 'malformed-provider-response'});

    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledWith(
      {
        operation: 'register-dynamic-webhook',
        providerErrors: ['Webhook URL is not approved', 'Invalid JQL filter'],
        providerErrorCount: 2,
      },
      'Jira dynamic webhook registration rejected',
    );
  });

  it('limits logged provider errors to five values', async () => {
    mocks.post.mockReturnValue(
      resolves({
        webhookRegistrationResult: [
          {
            errors: ['one', 'two', 'three', 'four', 'five', 'six'],
          },
        ],
      }),
    );
    const {createJiraApiClient} = await import('./client.js');

    await expect(
      createJiraApiClient().registerDynamicWebhook({
        accessToken: 'access-token',
        cloudId: 'cloud-1',
        url: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
      }),
    ).rejects.toMatchObject({reason: 'malformed-provider-response'});

    expect(mocks.warn).toHaveBeenCalledWith(
      {
        operation: 'register-dynamic-webhook',
        providerErrors: ['one', 'two', 'three', 'four', 'five'],
        providerErrorCount: 6,
      },
      'Jira dynamic webhook registration rejected',
    );
  });

  it('limits each logged provider error to 500 characters', async () => {
    const longError = 'x'.repeat(501);
    mocks.post.mockReturnValue(resolves({webhookRegistrationResult: [{errors: [longError]}]}));
    const {createJiraApiClient} = await import('./client.js');

    await expect(
      createJiraApiClient().registerDynamicWebhook({
        accessToken: 'access-token',
        cloudId: 'cloud-1',
        url: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
      }),
    ).rejects.toMatchObject({reason: 'malformed-provider-response'});

    expect(mocks.warn).toHaveBeenCalledWith(
      {
        operation: 'register-dynamic-webhook',
        providerErrors: ['x'.repeat(500)],
        providerErrorCount: 1,
      },
      'Jira dynamic webhook registration rejected',
    );
  });

  it('omits non-string provider errors from the warning', async () => {
    mocks.post.mockReturnValue(
      resolves({
        webhookRegistrationResult: [
          {errors: ['valid message', 42, null, {message: 'raw response'}, true]},
        ],
      }),
    );
    const {createJiraApiClient} = await import('./client.js');

    await expect(
      createJiraApiClient().registerDynamicWebhook({
        accessToken: 'access-token',
        cloudId: 'cloud-1',
        url: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
      }),
    ).rejects.toMatchObject({reason: 'malformed-provider-response'});

    expect(mocks.warn).toHaveBeenCalledWith(
      {
        operation: 'register-dynamic-webhook',
        providerErrors: ['valid message'],
        providerErrorCount: 5,
      },
      'Jira dynamic webhook registration rejected',
    );
  });

  it('accepts an empty provider errors array without logging a rejection', async () => {
    mocks.post.mockReturnValue(
      resolves({webhookRegistrationResult: [{createdWebhookId: 123, errors: []}]}),
    );
    const {createJiraApiClient} = await import('./client.js');

    await expect(
      createJiraApiClient().registerDynamicWebhook({
        accessToken: 'access-token',
        cloudId: 'cloud-1',
        url: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
      }),
    ).resolves.toEqual({webhookId: 123});
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('rejects a non-array provider errors value without logging it', async () => {
    mocks.post.mockReturnValue(
      resolves({
        webhookRegistrationResult: [{createdWebhookId: 123, errors: {message: 'do not log me'}}],
      }),
    );
    const {createJiraApiClient} = await import('./client.js');

    await expect(
      createJiraApiClient().registerDynamicWebhook({
        accessToken: 'access-token',
        cloudId: 'cloud-1',
        url: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
      }),
    ).rejects.toMatchObject({reason: 'malformed-provider-response'});
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('keeps the malformed provider response reason for a Jira rejection', async () => {
    mocks.post.mockReturnValue(
      resolves({webhookRegistrationResult: [{errors: ['Provider rejected the webhook']}]}),
    );
    const {createJiraApiClient} = await import('./client.js');

    await expect(
      createJiraApiClient().registerDynamicWebhook({
        accessToken: 'access-token',
        cloudId: 'cloud-1',
        url: 'https://shipfox.example.com/webhooks/integrations/jira/connection-1',
      }),
    ).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('deletes a dynamic webhook by id', async () => {
    mocks.delete.mockResolvedValue(undefined);
    const {createJiraApiClient} = await import('./client.js');

    await createJiraApiClient().deleteDynamicWebhook({
      accessToken: 'access-token',
      cloudId: 'cloud-1',
      webhookId: 123,
    });

    expect(mocks.delete).toHaveBeenCalledWith(
      'http://127.0.0.1:0/ex/jira/cloud-1/rest/api/3/webhook',
      expect.objectContaining({
        headers: {authorization: 'Bearer access-token'},
        json: {webhookIds: [123]},
      }),
    );
  });
});

describe('Jira agent-tools REST API', () => {
  beforeEach(() => {
    mocks.request.mockReset();
  });

  it('sends a REST v3 request and parses a JSON response', async () => {
    mocks.request.mockResolvedValue(
      new Response(JSON.stringify({id: '1004', key: 'ENG-1004'}), {status: 200}),
    );
    const {createJiraAgentToolsClient} = await import('./client.js');

    const result = await createJiraAgentToolsClient().request({
      accessToken: 'access-token',
      cloudId: 'cloud-1',
      method: 'GET',
      path: '/issue/ENG-1004',
      query: {fields: ['summary', 'description'], updateHistory: false},
      operation: 'get_issue',
    });

    expect(result).toEqual({status: 200, body: {id: '1004', key: 'ENG-1004'}});
    const [url, options] = mocks.request.mock.calls[0] as [
      string,
      {headers: Record<string, string>; searchParams: URLSearchParams},
    ];
    expect(url).toBe('http://127.0.0.1:0/ex/jira/cloud-1/rest/api/3/issue/ENG-1004');
    expect(options.headers).toEqual({authorization: 'Bearer access-token'});
    expect([...options.searchParams.entries()]).toEqual([
      ['fields', 'summary'],
      ['fields', 'description'],
      ['updateHistory', 'false'],
    ]);
  });

  it('maps HTTP 429 Retry-After responses to a rate-limited provider error', async () => {
    mocks.request.mockRejectedValue(
      new HTTPError(
        new Response(null, {status: 429, headers: {'retry-after': '19'}}),
        new Request('https://jira.example.test'),
        {} as never,
      ),
    );
    const {createJiraAgentToolsClient} = await import('./client.js');

    await expect(
      createJiraAgentToolsClient().request({
        accessToken: 'access-token',
        cloudId: 'cloud-1',
        method: 'GET',
        path: '/issue/ENG-1004',
        operation: 'get_issue',
      }),
    ).rejects.toMatchObject({reason: 'rate-limited', retryAfterSeconds: 19});
  });

  it('preserves Jira validation details from HTTP 400 responses', async () => {
    mocks.request.mockRejectedValue(
      new HTTPError(
        new Response(JSON.stringify({errorMessages: ['The JQL query is invalid']}), {status: 400}),
        new Request('https://jira.example.test'),
        {} as never,
      ),
    );
    const {createJiraAgentToolsClient} = await import('./client.js');

    await expect(
      createJiraAgentToolsClient().request({
        accessToken: 'access-token',
        cloudId: 'cloud-1',
        method: 'POST',
        path: '/search/jql',
        body: {jql: 'not valid'},
        operation: 'search_issues',
      }),
    ).resolves.toEqual({
      status: 400,
      body: {errorMessages: ['The JQL query is invalid']},
    });
  });

  it('maps HTTP 401 responses to an access-denied provider error', async () => {
    mocks.request.mockRejectedValue(
      new HTTPError(
        new Response(null, {status: 401}),
        new Request('https://jira.example.test'),
        {} as never,
      ),
    );
    const {createJiraAgentToolsClient} = await import('./client.js');

    await expect(
      createJiraAgentToolsClient().request({
        accessToken: 'access-token',
        cloudId: 'cloud-1',
        method: 'GET',
        path: '/issue/ENG-1004',
        operation: 'get_issue',
      }),
    ).rejects.toMatchObject({reason: 'access-denied'});
  });
});
