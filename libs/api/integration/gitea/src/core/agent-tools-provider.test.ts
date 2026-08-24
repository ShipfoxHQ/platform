import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {GiteaApiClient, GiteaIssue, GiteaIssueComment} from '#api/client.js';
import {giteaAgentToolCatalog, giteaAgentToolSelectionCatalog} from '#core/agent-tools.js';
import {GiteaAgentToolsProvider} from '#core/agent-tools-provider.js';
import {GiteaIntegrationProviderError} from '#core/errors.js';

const ISSUE: GiteaIssue = {
  id: 7,
  number: 3,
  title: 'Broken checkout',
  body: 'The checkout step times out.',
  state: 'open',
  comments: 2,
  htmlUrl: 'https://gitea.example.com/shipfox/platform/issues/3',
  createdAt: '2026-01-02T03:04:05Z',
  updatedAt: '2026-01-03T04:05:06Z',
};

const COMMENT: GiteaIssueComment = {
  id: 11,
  htmlUrl: 'https://gitea.example.com/shipfox/platform/issues/3#issuecomment-11',
  body: 'Fixed in the next release.',
  createdAt: '2026-01-04T05:06:07Z',
  updatedAt: '2026-01-04T05:06:07Z',
};

function giteaConnection(): IntegrationConnection<'gitea'> {
  const now = new Date();
  return {
    id: 'gitea-connection-1',
    workspaceId: 'workspace-1',
    provider: 'gitea',
    externalAccountId: 'shipfox',
    slug: 'gitea_shipfox',
    displayName: 'Gitea shipfox',
    lifecycleStatus: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

function catalogTool(id: string) {
  const tool = giteaAgentToolCatalog.find((candidate) => candidate.id === id);
  if (!tool) throw new Error(`Unknown test tool: ${id}`);
  return tool;
}

function providerOptions(
  gitea: Partial<Pick<GiteaApiClient, 'getIssue' | 'createIssueComment'>> = {},
) {
  return {
    gitea: {
      getIssue: vi.fn(() => Promise.resolve(ISSUE)),
      createIssueComment: vi.fn(() => Promise.resolve(COMMENT)),
      ...gitea,
    },
  };
}

async function openSession(
  options: ReturnType<typeof providerOptions>,
  toolIds: string[],
  connection = giteaConnection(),
) {
  const provider = new GiteaAgentToolsProvider(options);
  return await provider.openSession({
    connection,
    tools: toolIds.map(catalogTool),
    scope: {provider: 'gitea'},
  });
}

describe('GiteaAgentToolsProvider', () => {
  it('returns the Gitea agent tools catalogs', () => {
    const options = providerOptions();
    const provider = new GiteaAgentToolsProvider(options);

    const catalog = provider.catalog();
    const selectionCatalog = provider.selectionCatalog();

    expect(catalog).toBe(giteaAgentToolCatalog);
    expect(selectionCatalog).toBe(giteaAgentToolSelectionCatalog);
  });

  it('reads an issue from the connected organization and returns it as structured content', async () => {
    const options = providerOptions();
    const session = await openSession(options, ['get_issue']);

    const result = await session.call({
      toolId: 'get_issue',
      arguments: {repo: 'platform', index: 3},
    });

    expect(options.gitea.getIssue).toHaveBeenCalledWith({
      owner: 'shipfox',
      repo: 'platform',
      index: 3,
    });
    expect(result).toEqual({
      content: [{type: 'text', text: JSON.stringify(ISSUE)}],
      structuredContent: ISSUE,
    });
  });

  it('comments on an issue in the connected organization', async () => {
    const options = providerOptions();
    const session = await openSession(options, ['comment_on_issue']);

    const result = await session.call({
      toolId: 'comment_on_issue',
      arguments: {repo: 'platform', index: 3, body: 'Fixed in the next release.'},
    });

    expect(options.gitea.createIssueComment).toHaveBeenCalledWith({
      owner: 'shipfox',
      repo: 'platform',
      index: 3,
      body: 'Fixed in the next release.',
    });
    expect(result).toEqual({
      content: [{type: 'text', text: JSON.stringify(COMMENT)}],
      structuredContent: COMMENT,
    });
  });

  it('scopes every call to the session connection account', async () => {
    const options = providerOptions();
    const session = await openSession(options, ['get_issue', 'comment_on_issue'], {
      ...giteaConnection(),
      externalAccountId: 'acme',
    });

    await session.call({toolId: 'get_issue', arguments: {repo: 'platform', index: 1}});
    await session.call({
      toolId: 'comment_on_issue',
      arguments: {repo: 'platform', index: 1, body: 'Hello'},
    });

    expect(options.gitea.getIssue).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'platform',
      index: 1,
    });
    expect(options.gitea.createIssueComment).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'platform',
      index: 1,
      body: 'Hello',
    });
  });

  it('rejects a tool that was not selected for the session', async () => {
    const options = providerOptions();
    const session = await openSession(options, ['get_issue']);

    const result = await session.call({
      toolId: 'comment_on_issue',
      arguments: {repo: 'platform', index: 3, body: 'Hello'},
    });

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'Unknown Gitea tool: comment_on_issue'}],
    });
    expect(options.gitea.createIssueComment).not.toHaveBeenCalled();
  });

  it('rejects a call missing a required parameter', async () => {
    const options = providerOptions();
    const session = await openSession(options, ['comment_on_issue']);

    const result = await session.call({
      toolId: 'comment_on_issue',
      arguments: {repo: 'platform', index: 3},
    });

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'Missing required parameter: body'}],
    });
    expect(options.gitea.createIssueComment).not.toHaveBeenCalled();
  });

  it('maps a missing issue to a stable not-found code', async () => {
    const options = providerOptions({
      getIssue: vi.fn(() =>
        Promise.reject(
          new GiteaIntegrationProviderError('repository-not-found', 'Gitea responded 404'),
        ),
      ),
    });
    const session = await openSession(options, ['get_issue']);

    const result = await session.call({
      toolId: 'get_issue',
      arguments: {repo: 'platform', index: 99},
    });

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'Gitea responded 404'}],
      structuredContent: {code: 'repository-not-found'},
    });
  });

  it('preserves retry details from a transport-level rate limit', async () => {
    const options = providerOptions({
      getIssue: vi.fn(() =>
        Promise.reject(new GiteaIntegrationProviderError('rate-limited', 'Try again later', 19)),
      ),
    });
    const session = await openSession(options, ['get_issue']);

    const result = await session.call({
      toolId: 'get_issue',
      arguments: {repo: 'platform', index: 3},
    });

    expect(result).toMatchObject({
      isError: true,
      content: [{type: 'text', text: 'Try again later'}],
      structuredContent: {code: 'rate-limited', retryAfterSeconds: 19},
    });
  });

  it('maps an access failure to a stable access-denied code', async () => {
    const options = providerOptions({
      createIssueComment: vi.fn(() =>
        Promise.reject(new GiteaIntegrationProviderError('access-denied', 'Gitea responded 403')),
      ),
    });
    const session = await openSession(options, ['comment_on_issue']);

    const result = await session.call({
      toolId: 'comment_on_issue',
      arguments: {repo: 'platform', index: 3, body: 'Hello'},
    });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {code: 'access-denied'},
    });
  });

  it('rethrows an unexpected client failure', async () => {
    const options = providerOptions({
      getIssue: vi.fn(() => Promise.reject(new Error('boom'))),
    });
    const session = await openSession(options, ['get_issue']);

    const result = session.call({toolId: 'get_issue', arguments: {repo: 'platform', index: 3}});

    await expect(result).rejects.toThrow('boom');
  });
});
