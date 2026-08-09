import {RequestError} from 'octokit';
import type {GithubApiClient} from '#api/client.js';
import {DEFAULT_JOB_LOG_TAIL_LINES} from '#core/actions-logs.js';
import {
  type GithubAgentToolId,
  GithubAgentToolsProvider,
  type GithubToolClient,
  githubAgentToolCatalog,
  githubAgentToolSelectionCatalog,
} from '#core/agent-tools.js';
import {createGithubIntegrationProvider} from '#index.js';

const expectedCatalogRows = [
  {
    id: 'issue_read',
    category: 'issues',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'read'}],
    methods: ['get', 'get_comments', 'get_sub_issues', 'get_parent', 'get_labels'],
  },
  {
    id: 'list_issue_types',
    category: 'issues',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'read'}],
  },
  {
    id: 'list_issues',
    category: 'issues',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'read'}],
  },
  {
    id: 'search_issues',
    category: 'issues',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'read'}],
  },
  {
    id: 'add_issue_comment',
    category: 'issues',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'write'}],
  },
  {
    id: 'issue_write',
    category: 'issues',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'write'}],
    methods: ['create', 'update'],
  },
  {
    id: 'sub_issue_write',
    category: 'issues',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'write'}],
    methods: ['add', 'remove', 'reprioritize'],
  },
  {
    id: 'pull_request_read',
    category: 'pull_requests',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [
      {permission: 'pull_requests', access: 'read'},
      {permission: 'issues', access: 'read'},
    ],
    methods: [
      'get',
      'get_diff',
      'get_status',
      'get_files',
      'get_commits',
      'get_review_comments',
      'get_reviews',
      'get_comments',
      'get_check_runs',
    ],
  },
  {
    id: 'list_pull_requests',
    category: 'pull_requests',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'read'}],
  },
  {
    id: 'search_pull_requests',
    category: 'pull_requests',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'read'}],
  },
  {
    id: 'create_pull_request',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'write'}],
  },
  {
    id: 'update_pull_request',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'write'}],
  },
  {
    id: 'add_reply_to_pull_request_comment',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'write'}],
  },
  {
    id: 'merge_pull_request',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: [
      {permission: 'pull_requests', access: 'write'},
      {permission: 'contents', access: 'write'},
    ],
  },
  {
    id: 'update_pull_request_branch',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'write'}],
  },
  {
    id: 'pull_request_review_write',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'write'}],
    methods: ['create', 'submit_pending', 'delete_pending'],
  },
  {
    id: 'add_comment_to_pending_review',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'write'}],
  },
  {
    id: 'actions_list',
    category: 'actions',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'actions', access: 'read'}],
    methods: [
      'list_workflows',
      'list_workflow_runs',
      'list_workflow_jobs',
      'list_workflow_run_artifacts',
    ],
  },
  {
    id: 'actions_get',
    category: 'actions',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'actions', access: 'read'}],
    methods: [
      'get_workflow',
      'get_workflow_run',
      'get_workflow_job',
      'download_workflow_run_artifact',
      'get_workflow_run_usage',
      'get_workflow_run_logs_url',
    ],
  },
  {
    id: 'actions_run_trigger',
    category: 'actions',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: [{permission: 'actions', access: 'write'}],
    methods: [
      'run_workflow',
      'rerun_workflow_run',
      'rerun_failed_jobs',
      'cancel_workflow_run',
      'delete_workflow_run_logs',
    ],
  },
  {
    id: 'get_job_logs',
    category: 'actions',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [{permission: 'actions', access: 'read'}],
  },
];

describe('github agent tool catalog', () => {
  it('matches the GitHub MCP-style tool rows', () => {
    const rows = githubAgentToolCatalog.map(
      ({id, category, sensitivity, sensitive, requiredScope, methods}) => ({
        id,
        category,
        sensitivity,
        sensitive,
        requiredScope,
        ...(methods ? {methods: methods.map((method) => method.id)} : {}),
      }),
    );

    expect(rows).toEqual(expectedCatalogRows);
  });

  it('defines descriptions and schemas for every tool and method', () => {
    const entriesMissingCatalogData = githubAgentToolCatalog.filter(
      (entry) =>
        entry.description.trim().length === 0 ||
        entry.inputSchema.type !== 'object' ||
        entry.outputSchema?.type !== 'object' ||
        entry.methods?.some((method) => method.description.trim().length === 0),
    );

    expect(entriesMissingCatalogData).toEqual([]);
  });

  it('defines method enums for method-based tools', () => {
    const entriesWithWrongMethodEnums = githubAgentToolCatalog.filter((entry) => {
      if (!entry.methods) return false;

      const inputSchema = entry.inputSchema as {
        properties?: Record<string, {enum?: unknown[] | undefined}> | undefined;
      };
      const methodProperty = inputSchema.properties?.method;
      return (
        !methodProperty ||
        !Array.isArray(methodProperty.enum) ||
        methodProperty.enum.join(',') !== entry.methods.map((method) => method.id).join(',')
      );
    });

    expect(entriesWithWrongMethodEnums).toEqual([]);
  });

  it('uses unique bare native ids', () => {
    const ids = githubAgentToolCatalog.map((entry) => entry.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
    expect(ids.every((id) => !id.includes('.') && !id.includes('__'))).toBe(true);
  });

  it('keeps reviewed input constraints aligned with GitHub operations', () => {
    const listIssueTypesSchema = inputSchemaFor('list_issue_types');
    const addIssueCommentSchema = inputSchemaFor('add_issue_comment');
    const updatePullRequestSchema = inputSchemaFor('update_pull_request');
    const addReplySchema = inputSchemaFor('add_reply_to_pull_request_comment');
    const pullRequestReadSchema = inputSchemaFor('pull_request_read');
    const actionsRunTriggerSchema = inputSchemaFor('actions_run_trigger');
    const getJobLogsSchema = inputSchemaFor('get_job_logs');

    expect(listIssueTypesSchema.required).toEqual(['owner']);
    expect(updatePullRequestSchema.properties).not.toHaveProperty('draft');
    expect(addIssueCommentSchema.anyOf).toEqual([
      {required: ['issue_number', 'body']},
      {required: ['issue_number', 'reaction']},
      {required: ['comment_id', 'reaction']},
    ]);
    expect(addReplySchema.anyOf).toEqual([
      {required: ['pull_number', 'body']},
      {required: ['reaction']},
    ]);
    expect(pullRequestReadSchema.oneOf).toEqual([
      {properties: {method: {const: 'get'}}, required: []},
      {properties: {method: {const: 'get_diff'}}, required: []},
      {properties: {method: {const: 'get_status'}}, required: ['ref']},
      {properties: {method: {const: 'get_files'}}, required: []},
      {properties: {method: {const: 'get_commits'}}, required: []},
      {properties: {method: {const: 'get_review_comments'}}, required: []},
      {properties: {method: {const: 'get_reviews'}}, required: []},
      {properties: {method: {const: 'get_comments'}}, required: []},
      {properties: {method: {const: 'get_check_runs'}}, required: ['ref']},
    ]);
    expect(actionsRunTriggerSchema.oneOf).toEqual([
      {properties: {method: {const: 'run_workflow'}}, required: ['workflow_id', 'ref']},
      {properties: {method: {const: 'rerun_workflow_run'}}, required: ['run_id']},
      {properties: {method: {const: 'rerun_failed_jobs'}}, required: ['run_id']},
      {properties: {method: {const: 'cancel_workflow_run'}}, required: ['run_id']},
      {properties: {method: {const: 'delete_workflow_run_logs'}}, required: ['run_id']},
    ]);
    expect(getJobLogsSchema.properties?.return_content).toMatchObject({
      type: 'boolean',
    });
    expect(getJobLogsSchema.properties?.job_id).toMatchObject({type: 'number'});
    expect(getJobLogsSchema.properties?.run_id).toMatchObject({type: 'number'});
    expect(getJobLogsSchema.properties?.tail_lines).toMatchObject({
      type: 'number',
      default: DEFAULT_JOB_LOG_TAIL_LINES,
    });
  });

  it('exposes the catalog through the provider adapter', () => {
    const provider = createProvider();
    const catalog = provider.adapters.agent_tools?.catalog();
    const selectionCatalog = provider.adapters.agent_tools?.selectionCatalog();

    expect(provider.adapters.agent_tools).toBeDefined();
    expect(catalog).toBe(githubAgentToolCatalog);
    expect(selectionCatalog).toBe(githubAgentToolSelectionCatalog);
  });

  it('fails closed when the connection has no GitHub installation', async () => {
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(undefined)),
    });

    const result = provider.openSession({
      connection: connection(),
      tools: [githubAgentToolCatalog[0]],
      scope: undefined,
    });

    await expect(result).rejects.toMatchObject({reason: 'installation-not-found'});
  });

  it('opens a provider-owned installation session and dispatches the selected operation', async () => {
    const request = vi.fn(() => Promise.resolve({data: {number: 1}}));
    let clientToken: string | undefined;
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {
        getInstallationAccessToken: vi.fn(() =>
          Promise.resolve({
            token: 'installation-token',
            expiresAt: new Date(),
            permissions: {issues: 'read' as const},
          }),
        ),
      },
      createClient: vi.fn((token) => {
        clientToken = token;
        return {request};
      }),
    });

    const session = await provider.openSession({
      connection: connection(),
      tools: [githubAgentToolCatalog[0]],
      scope: undefined,
    });
    const result = await session.call({
      toolId: 'issue_read',
      arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
    });

    expect(request).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/issues/{issue_number}', {
      owner: 'shipfox',
      repo: 'platform',
      issue_number: 1,
    });
    expect(clientToken).toBe('installation-token');
    expect(result).toEqual({
      content: [{type: 'text', text: '{"number":1}'}],
      structuredContent: {number: 1},
    });
  });

  it('adds a comment to the latest pending review through GraphQL', async () => {
    const request = vi.fn();
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({
        viewer: {login: 'shipfox-ai[bot]'},
        repository: {
          pullRequest: {
            reviews: {
              nodes: [
                {
                  id: 'review-older',
                  author: {login: 'shipfox-ai[bot]'},
                  createdAt: '2026-08-09T10:00:00Z',
                },
                {
                  id: 'review-latest',
                  author: {login: 'shipfox-ai[bot]'},
                  createdAt: '2026-08-09T10:01:00Z',
                },
              ],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        addPullRequestReviewThread: {thread: {id: 'thread-1'}},
      });
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [pendingReviewTool()],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'add_comment_to_pending_review',
      arguments: {
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        path: 'src/agent-tools.ts',
        body: 'Please handle this error.',
        subject_type: 'LINE',
        line: 42,
        side: 'RIGHT',
        start_line: 40,
        start_side: 'RIGHT',
      },
    });

    expect(request).not.toHaveBeenCalled();
    expect(graphql).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('reviews(last: 100, states: [PENDING])'),
      {owner: 'shipfox', repo: 'platform', pullNumber: 2},
    );
    expect(graphql).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('addPullRequestReviewThread'),
      {
        input: {
          pullRequestReviewId: 'review-latest',
          path: 'src/agent-tools.ts',
          body: 'Please handle this error.',
          subjectType: 'LINE',
          line: 42,
          side: 'RIGHT',
          startLine: 40,
          startSide: 'RIGHT',
        },
      },
    );
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: '{"addPullRequestReviewThread":{"thread":{"id":"thread-1"}}}',
        },
      ],
      structuredContent: {addPullRequestReviewThread: {thread: {id: 'thread-1'}}},
    });
  });

  it('returns an explicit error when there is no pending review for the caller', async () => {
    const request = vi.fn();
    const graphql = vi.fn().mockResolvedValueOnce({
      viewer: {login: 'shipfox-ai[bot]'},
      repository: {
        pullRequest: {
          reviews: {
            nodes: [
              {
                id: 'review-other-user',
                author: {login: 'another-user'},
                createdAt: '2026-08-09T10:00:00Z',
              },
            ],
          },
        },
      },
    });
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [pendingReviewTool()],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'add_comment_to_pending_review',
      arguments: {
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        path: 'src/agent-tools.ts',
        body: 'Please handle this error.',
      },
    });

    expect(graphql).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'No pending pull request review found for the authenticated GitHub user.',
        },
      ],
    });
  });

  it('maps Octokit 4xx failures to terminal provider errors', async () => {
    const providerError = new RequestError('commit_id is missing', 422, {
      request: {
        method: 'POST',
        url: 'https://api.github.com/repos/shipfox/platform/issues/1',
        headers: {},
      },
    });
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {
        getInstallationAccessToken: vi.fn(() =>
          Promise.resolve({
            token: 'installation-token',
            expiresAt: new Date(),
            permissions: {issues: 'read' as const},
          }),
        ),
      },
      createClient: vi.fn(() => ({
        request: vi.fn(() => Promise.reject(providerError)),
      })),
    });
    const session = await provider.openSession({
      connection: connection(),
      tools: [githubAgentToolCatalog[0]],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      }),
    ).rejects.toMatchObject({
      reason: 'provider-rejected',
      message: 'commit_id is missing',
      status: 422,
    });
  });

  it('requires a ref for pull request status and check-run reads', async () => {
    const result = await callGithubTool(
      'pull_request_read',
      {method: 'get_status', owner: 'shipfox', repo: 'platform', pull_number: 2},
      {state: 'success'},
    );

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'Missing required parameter: ref'}],
    });
  });

  it.each([
    {
      method: 'submit_pending',
      arguments: {
        method: 'submit_pending',
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        body: 'Please address this before merging.',
        event: 'REQUEST_CHANGES',
      },
      route: 'POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events',
      parameters: {
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        body: 'Please address this before merging.',
        event: 'REQUEST_CHANGES',
        review_id: 42,
      },
      data: {id: 42, state: 'CHANGES_REQUESTED'},
    },
    {
      method: 'delete_pending',
      arguments: {
        method: 'delete_pending',
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
      },
      route: 'DELETE /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}',
      parameters: {
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        review_id: 42,
      },
      data: {id: 42, state: 'PENDING'},
    },
  ] satisfies Array<{
    method: 'submit_pending' | 'delete_pending';
    arguments: Record<string, unknown>;
    route: string;
    parameters: Record<string, unknown>;
    data: unknown;
  }>)('$method resolves the latest pending review before writing', async (testCase) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {id: 40, state: 'APPROVED'},
          {id: 41, state: 'PENDING'},
          {id: 42, state: 'PENDING'},
        ],
      })
      .mockResolvedValueOnce({data: testCase.data});

    const result = await callGithubToolWithRequest(
      'pull_request_review_write',
      testCase.arguments,
      request,
    );

    expect(result).toEqual({
      content: [{type: 'text', text: JSON.stringify(testCase.data)}],
      structuredContent: testCase.data,
    });
    expect(request).toHaveBeenNthCalledWith(
      1,
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
      {
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        per_page: 100,
        page: 1,
      },
    );
    expect(request).toHaveBeenNthCalledWith(2, testCase.route, testCase.parameters);
  });

  it('resolves a pending review from a later review page', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: Array.from({length: 100}, (_, index) => ({id: index + 1, state: 'APPROVED'})),
      })
      .mockResolvedValueOnce({data: [{id: 101, state: 'PENDING'}]})
      .mockResolvedValueOnce({data: {id: 101, state: 'COMMENTED'}});

    const result = await callGithubToolWithRequest(
      'pull_request_review_write',
      {
        method: 'submit_pending',
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        body: 'Looks good.',
        event: 'COMMENT',
      },
      request,
    );

    expect(result).toEqual({
      content: [{type: 'text', text: JSON.stringify({id: 101, state: 'COMMENTED'})}],
      structuredContent: {id: 101, state: 'COMMENTED'},
    });
    expect(request).toHaveBeenNthCalledWith(
      1,
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
      {
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        per_page: 100,
        page: 1,
      },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
      {
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        per_page: 100,
        page: 2,
      },
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      'POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events',
      {
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        body: 'Looks good.',
        event: 'COMMENT',
        review_id: 101,
      },
    );
  });

  it.each([
    'submit_pending',
    'delete_pending',
  ] as const)('%s reports when no pending review exists', async (method) => {
    const request = vi.fn(() => Promise.resolve({data: []}));

    const result = await callGithubToolWithRequest(
      'pull_request_review_write',
      {method, owner: 'shipfox', repo: 'platform', pull_number: 2},
      request,
    );

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'No pending pull request review found for the authenticated GitHub user.',
        },
      ],
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([
    {
      toolId: 'list_issue_types',
      arguments: {owner: 'shipfox'},
      data: [{id: 1}],
      expected: {issue_types: [{id: 1}]},
    },
    {
      toolId: 'list_issues',
      arguments: {owner: 'shipfox', repo: 'platform'},
      data: [{number: 1}],
      expected: {issues: [{number: 1}]},
    },
    {
      toolId: 'search_issues',
      arguments: {query: 'is:open'},
      data: {items: [{number: 1}], total_count: 1},
      expected: {issues: [{number: 1}]},
    },
    {
      toolId: 'list_pull_requests',
      arguments: {owner: 'shipfox', repo: 'platform'},
      data: [{number: 2}],
      expected: {pull_requests: [{number: 2}]},
    },
    {
      toolId: 'search_pull_requests',
      arguments: {query: 'is:open'},
      data: {items: [{number: 2}], total_count: 1},
      expected: {pull_requests: [{number: 2}]},
    },
    {
      toolId: 'create_pull_request',
      arguments: {
        owner: 'shipfox',
        repo: 'platform',
        title: 'Title',
        head: 'feature',
        base: 'main',
      },
      data: {number: 2},
      expected: {pull_request: {number: 2}},
    },
    {
      toolId: 'update_pull_request',
      arguments: {owner: 'shipfox', repo: 'platform', pull_number: 2},
      data: {number: 2, title: 'Updated'},
      expected: {pull_request: {number: 2, title: 'Updated'}},
    },
    {
      toolId: 'merge_pull_request',
      arguments: {owner: 'shipfox', repo: 'platform', pull_number: 2},
      data: {merged: true},
      expected: {merge: {merged: true}},
    },
    {
      toolId: 'pull_request_read',
      arguments: {
        method: 'get_diff',
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
      },
      data: 'diff --git a/file b/file',
      expected: {result: 'diff --git a/file b/file'},
    },
    {
      toolId: 'pull_request_read',
      arguments: {
        method: 'get_check_runs',
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        ref: 'abc123',
      },
      data: {total_count: 1},
      expected: {total_count: 1},
    },
  ] satisfies Array<{
    toolId: GithubAgentToolId;
    arguments: Record<string, unknown>;
    data: unknown;
    expected: Record<string, unknown>;
  }>)('projects $toolId responses to their output schema', async (testCase) => {
    const result = await callGithubTool(testCase.toolId, testCase.arguments, testCase.data);

    expect(result).toEqual({
      content: [{type: 'text', text: JSON.stringify(testCase.expected)}],
      structuredContent: testCase.expected,
    });
  });
});

async function callGithubTool(
  toolId: GithubAgentToolId,
  arguments_: Record<string, unknown>,
  data: unknown,
) {
  return await callGithubToolWithRequest(
    toolId,
    arguments_,
    vi.fn(() => Promise.resolve({data})),
  );
}

async function callGithubToolWithRequest(
  toolId: GithubAgentToolId,
  arguments_: Record<string, unknown>,
  request: GithubToolClient['request'],
) {
  const tool = githubAgentToolCatalog.find((entry) => entry.id === toolId);
  if (!tool) throw new Error(`Missing GitHub tool: ${toolId}`);
  const provider = createAgentToolsProvider({request});
  const session = await provider.openSession({
    connection: connection(),
    tools: [tool],
    scope: undefined,
  });

  return await session.call({toolId, arguments: arguments_});
}

function createAgentToolsProvider(client: GithubToolClient) {
  return new GithubAgentToolsProvider({
    getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
    tokenProvider: {
      getInstallationAccessToken: vi.fn(() =>
        Promise.resolve({
          token: 'installation-token',
          expiresAt: new Date(),
          permissions: {
            actions: 'write' as const,
            contents: 'write' as const,
            issues: 'write' as const,
            pull_requests: 'write' as const,
          },
        }),
      ),
    },
    createClient: vi.fn(() => client),
  });
}

function pendingReviewTool() {
  const tool = githubAgentToolCatalog.find((entry) => entry.id === 'add_comment_to_pending_review');
  if (!tool) throw new Error('Missing add_comment_to_pending_review tool');
  return tool;
}

function connection() {
  return {
    id: 'connection-1',
    workspaceId: 'workspace-1',
    provider: 'github' as const,
    externalAccountId: 'github:1',
    slug: 'github-main',
    displayName: 'GitHub',
    lifecycleStatus: 'active' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function installation() {
  return {
    id: 'installation-row-1',
    connectionId: 'connection-1',
    installationId: '1',
    accountLogin: 'shipfox',
    accountType: 'Organization',
    repositorySelection: 'all',
    suspendedAt: null,
    deletedAt: null,
    latestEvent: {},
    installerUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createProvider() {
  return createGithubIntegrationProvider({
    github: githubClient(),
    getExistingGithubConnection: vi.fn(() => Promise.resolve(undefined)),
    connectGithubInstallation: vi.fn() as never,
    coreDb: vi.fn() as never,
    publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: false})),
    publishSourceRepositoryUpdated: vi.fn(() => Promise.resolve({published: false})),
    publishSourcePush: vi.fn(() => Promise.resolve({published: false})),
    recordDeliveryOnly: vi.fn(() => Promise.resolve()),
    getIntegrationConnectionById: vi.fn(() => Promise.resolve(undefined)),
  });
}

function githubClient(): GithubApiClient {
  return {
    exchangeOAuthCode: vi.fn(() => Promise.reject(new Error('not used'))),
    listUserInstallations: vi.fn(() => Promise.reject(new Error('not used'))),
    getInstallation: vi.fn(() => Promise.reject(new Error('not used'))),
    listInstallationRepositories: vi.fn(() => Promise.reject(new Error('not used'))),
    getRepository: vi.fn(() => Promise.reject(new Error('not used'))),
    listRepositoryFiles: vi.fn(() => Promise.reject(new Error('not used'))),
    fetchRepositoryFile: vi.fn(() => Promise.reject(new Error('not used'))),
    createInstallationAccessToken: vi.fn(() => Promise.reject(new Error('not used'))),
  };
}

function inputSchemaFor(id: (typeof githubAgentToolCatalog)[number]['id']) {
  return githubAgentToolCatalog.find((entry) => entry.id === id)?.inputSchema as {
    properties?: Record<string, unknown> | undefined;
    required?: string[] | undefined;
    anyOf?: unknown[] | undefined;
    oneOf?: unknown[] | undefined;
  };
}
