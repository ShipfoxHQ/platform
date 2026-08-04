import {HTTPError} from 'ky';
import type {JiraIntegrationProviderError} from '#core/errors.js';
import {mapJiraError} from './client.js';

const mocks = vi.hoisted(() => ({delete: vi.fn(), post: vi.fn()}));

vi.mock('ky', () => {
  class MockHTTPError extends Error {
    constructor(public response: {status: number; statusText?: string; headers: Headers}) {
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
    default: {delete: mocks.delete, post: mocks.post},
    HTTPError: MockHTTPError,
    TimeoutError: MockTimeoutError,
  };
});

function rejectedRequest(status: number, body?: {error: string}): () => Promise<never> {
  return () =>
    Promise.reject(
      new HTTPError(
        new Response(body ? JSON.stringify(body) : null, {
          status,
          ...(body ? {headers: {'content-type': 'application/json'}} : {}),
        }),
        new Request('https://jira.example.test'),
        {} as never,
      ),
    );
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
