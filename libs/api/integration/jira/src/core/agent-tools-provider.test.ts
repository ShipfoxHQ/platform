import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {JiraAgentToolsClient} from '#api/client.js';
import {
  type JiraAgentToolId,
  jiraAgentToolCatalog,
  jiraAgentToolSelectionCatalog,
  jiraPlainTextToAdf,
} from '#core/agent-tools.js';
import {JiraAgentToolsProvider} from '#core/agent-tools-provider.js';
import {JiraIntegrationProviderError} from '#core/errors.js';

function jiraConnection(
  overrides: Partial<IntegrationConnection<'jira'>> = {},
): IntegrationConnection<'jira'> {
  const now = new Date();
  return {
    id: 'jira-connection-1',
    workspaceId: 'workspace-1',
    provider: 'jira',
    externalAccountId: 'cloud-1',
    slug: 'jira-acme',
    displayName: 'Jira Acme',
    lifecycleStatus: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
    repositoryAccessMode: overrides.repositoryAccessMode ?? 'selected',
  };
}

function catalogTool(id: JiraAgentToolId) {
  const tool = jiraAgentToolCatalog.find((candidate) => candidate.id === id);
  if (!tool) throw new Error(`Unknown test tool: ${id}`);
  return tool;
}

function providerOptions(
  request: JiraAgentToolsClient['request'] = async () => ({status: 200, body: {ok: true}}),
) {
  return {
    jira: {request: vi.fn(request)},
    tokenStore: {getAccessToken: vi.fn().mockResolvedValue('access-token')},
  };
}

async function openSession(
  options: ReturnType<typeof providerOptions>,
  toolIds: JiraAgentToolId[],
  connection = jiraConnection(),
) {
  const provider = new JiraAgentToolsProvider(options);
  return await provider.openSession({
    connection,
    tools: toolIds.map(catalogTool),
    scope: {provider: 'jira'},
  });
}

describe('JiraAgentToolsProvider', () => {
  it('returns the Jira agent tools catalogs', () => {
    const provider = new JiraAgentToolsProvider(providerOptions());

    expect(provider.catalog()).toBe(jiraAgentToolCatalog);
    expect(provider.selectionCatalog()).toBe(jiraAgentToolSelectionCatalog);
    expect(provider.catalog().map((tool) => [tool.id, tool.sensitivity, tool.sensitive])).toEqual([
      ['get_issue', 'read', false],
      ['search_issues', 'read', false],
      ['get_issue_comments', 'read', false],
      ['get_issue_transitions', 'read', false],
      ['get_project', 'read', false],
      ['get_user', 'read', false],
      ['create_issue', 'write', false],
      ['update_issue', 'write', false],
      ['add_comment', 'write', false],
      ['transition_issue', 'write', false],
      ['assign_issue', 'write', false],
    ]);
  });

  it('reads the stored token before opening a session', async () => {
    const options = providerOptions();
    const provider = new JiraAgentToolsProvider(options);

    await provider.openSession({
      connection: jiraConnection({id: 'jira-connection-7'}),
      tools: [],
      scope: {provider: 'jira'},
    });

    expect(options.tokenStore.getAccessToken).toHaveBeenCalledWith({
      connectionId: 'jira-connection-7',
    });
  });

  it('dispatches a read request with the cloud id and returns structured content', async () => {
    const body = {id: '1004', key: 'ENG-1004', fields: {summary: 'Jira tools'}};
    const options = providerOptions(async () => ({status: 200, body}));
    const session = await openSession(options, ['get_issue']);

    const result = await session.call({
      toolId: 'get_issue',
      arguments: {idOrKey: 'ENG-1004', fields: ['summary']},
    });

    expect(options.jira.request).toHaveBeenCalledWith({
      accessToken: 'access-token',
      cloudId: 'cloud-1',
      method: 'GET',
      path: '/issue/ENG-1004',
      query: {fields: ['summary']},
      operation: 'get_issue',
    });
    expect(result).toEqual({
      content: [{type: 'text', text: JSON.stringify(body)}],
      structuredContent: body,
    });
  });

  it('wraps add-comment text in the minimal Jira ADF document', async () => {
    const options = providerOptions();
    const session = await openSession(options, ['add_comment']);

    await session.call({
      toolId: 'add_comment',
      arguments: {idOrKey: 'ENG-1004', body: 'The adapter is ready.'},
    });

    expect(options.jira.request).toHaveBeenCalledWith({
      accessToken: 'access-token',
      cloudId: 'cloud-1',
      method: 'POST',
      path: '/issue/ENG-1004/comment',
      body: {body: jiraPlainTextToAdf('The adapter is ready.')},
      operation: 'add_comment',
    });
  });

  it('wraps create and update issue descriptions in ADF', async () => {
    const options = providerOptions();
    const createSession = await openSession(options, ['create_issue']);
    const updateSession = await openSession(options, ['update_issue']);

    await createSession.call({
      toolId: 'create_issue',
      arguments: {
        projectKey: 'ENG',
        summary: 'New issue',
        issueType: 'Task',
        body: 'A plain-text description',
      },
    });
    await updateSession.call({
      toolId: 'update_issue',
      arguments: {idOrKey: 'ENG-1004', body: 'A replacement description'},
    });

    expect(options.jira.request).toHaveBeenNthCalledWith(1, {
      accessToken: 'access-token',
      cloudId: 'cloud-1',
      method: 'POST',
      path: '/issue',
      body: {
        fields: {
          project: {key: 'ENG'},
          summary: 'New issue',
          issuetype: {name: 'Task'},
          description: jiraPlainTextToAdf('A plain-text description'),
        },
      },
      operation: 'create_issue',
    });
    expect(options.jira.request).toHaveBeenNthCalledWith(2, {
      accessToken: 'access-token',
      cloudId: 'cloud-1',
      method: 'PUT',
      path: '/issue/ENG-1004',
      body: {fields: {description: jiraPlainTextToAdf('A replacement description')}},
      operation: 'update_issue',
    });
  });

  it('maps provider rate limits and preserves Retry-After details', async () => {
    const options = providerOptions(() =>
      Promise.reject(new JiraIntegrationProviderError('rate-limited', 'Try again later', 19)),
    );
    const session = await openSession(options, ['search_issues']);

    const result = await session.call({
      toolId: 'search_issues',
      arguments: {jql: 'project = ENG'},
    });

    expect(result).toMatchObject({
      isError: true,
      content: [{type: 'text', text: 'Try again later'}],
      structuredContent: {code: 'rate-limited', retryAfterSeconds: 19},
    });
  });

  it('maps Jira authorization failures to access-denied', async () => {
    const options = providerOptions(() =>
      Promise.reject(
        new JiraIntegrationProviderError('access-denied', 'Jira request was rejected'),
      ),
    );
    const session = await openSession(options, ['get_project']);

    const result = await session.call({
      toolId: 'get_project',
      arguments: {idOrKey: 'ENG'},
    });

    expect(result).toMatchObject({
      isError: true,
      content: [{type: 'text', text: 'Jira request was rejected'}],
      structuredContent: {code: 'access-denied'},
    });
  });

  it('returns Jira resource errors as tool errors', async () => {
    const options = providerOptions(async () => ({
      status: 404,
      body: {errorMessages: ['Issue does not exist']},
    }));
    const session = await openSession(options, ['get_issue']);

    const result = await session.call({
      toolId: 'get_issue',
      arguments: {idOrKey: 'ENG-404'},
    });

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'Issue does not exist'}],
    });
  });

  it('returns Jira validation details for a bad request', async () => {
    const options = providerOptions(async () => ({
      status: 400,
      body: {errorMessages: ['The JQL query is invalid']},
    }));
    const session = await openSession(options, ['search_issues']);

    const result = await session.call({
      toolId: 'search_issues',
      arguments: {jql: 'not valid'},
    });

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'The JQL query is invalid'}],
    });
  });

  it('reports successful empty Jira responses with their HTTP status', async () => {
    const options = providerOptions(async () => ({status: 204, body: undefined}));
    const session = await openSession(options, ['assign_issue']);

    const result = await session.call({
      toolId: 'assign_issue',
      arguments: {idOrKey: 'ENG-1004', accountId: null},
    });

    expect(result).toEqual({
      content: [{type: 'text', text: JSON.stringify({status: 204})}],
      structuredContent: {status: 204},
    });
  });

  it('rejects calls for unselected tools and missing required arguments', async () => {
    const options = providerOptions();
    const session = await openSession(options, ['get_issue']);

    await expect(
      session.call({toolId: 'add_comment', arguments: {idOrKey: 'ENG-1004', body: 'Comment'}}),
    ).resolves.toEqual({
      isError: true,
      content: [{type: 'text', text: 'Unknown Jira tool: add_comment'}],
    });
    await expect(session.call({toolId: 'get_issue', arguments: {}})).resolves.toEqual({
      isError: true,
      content: [{type: 'text', text: 'Missing required parameter: idOrKey'}],
    });
    expect(options.jira.request).not.toHaveBeenCalled();
  });

  it('rejects create calls that omit the summary', async () => {
    const options = providerOptions();
    const session = await openSession(options, ['create_issue']);

    const result = await session.call({toolId: 'create_issue', arguments: {}});

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'Missing required parameter: summary'}],
    });
    expect(options.jira.request).not.toHaveBeenCalled();
  });
});
