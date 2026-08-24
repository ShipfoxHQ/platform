import {RequestError} from 'octokit';
import type {GithubApiClient} from '#api/client.js';
import {DEFAULT_JOB_LOG_TAIL_LINES} from '#core/actions-logs.js';
import {
  type GithubAgentToolId,
  GithubAgentToolsProvider,
  type GithubToolClient,
  githubAgentToolCatalog,
  githubAgentToolSelectionCatalog,
  githubOperationRoute,
  projectGithubOperationParameters,
} from '#core/agent-tools.js';
import {createGithubIntegrationProvider} from '#index.js';

const githubAppReviewUser = {login: 'shipfox-test[bot]'};

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
      'get_review_threads',
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
    id: 'pull_request_review_thread_write',
    category: 'pull_requests',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'pull_requests', access: 'write'}],
    methods: ['resolve'],
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

type GithubOperationRouteCase = {
  toolId: GithubAgentToolId;
  method?: string;
  args: Record<string, unknown>;
  expectedRoute: string;
  runtimeInjectedProperties?: readonly string[];
};

const githubOperationRouteCases = [
  {
    toolId: 'issue_read',
    method: 'get',
    args: {issue_number: 1},
    expectedRoute: 'GET /repos/{owner}/{repo}/issues/{issue_number}',
  },
  {
    toolId: 'issue_read',
    method: 'get_comments',
    args: {issue_number: 1},
    expectedRoute: 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
  },
  {
    toolId: 'issue_read',
    method: 'get_sub_issues',
    args: {issue_number: 1},
    expectedRoute: 'GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
  },
  {
    toolId: 'issue_read',
    method: 'get_parent',
    args: {issue_number: 1},
    expectedRoute: 'GET /repos/{owner}/{repo}/issues/{issue_number}/parent',
  },
  {
    toolId: 'issue_read',
    method: 'get_labels',
    args: {issue_number: 1},
    expectedRoute: 'GET /repos/{owner}/{repo}/issues/{issue_number}/labels',
  },
  {
    toolId: 'list_issue_types',
    args: {owner: 'shipfox'},
    expectedRoute: 'GET /orgs/{owner}/issue-types',
  },
  {
    toolId: 'list_issue_types',
    args: {owner: 'shipfox', repo: 'platform'},
    expectedRoute: 'GET /repos/{owner}/{repo}/issue-types',
  },
  {
    toolId: 'list_issues',
    args: {},
    expectedRoute: 'GET /repos/{owner}/{repo}/issues',
  },
  {
    toolId: 'search_issues',
    args: {},
    expectedRoute: 'GET /search/issues',
  },
  {
    toolId: 'add_issue_comment',
    args: {issue_number: 1, body: 'Comment'},
    expectedRoute: 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
  },
  {
    toolId: 'add_issue_comment',
    args: {issue_number: 1, reaction: '+1'},
    expectedRoute: 'POST /repos/{owner}/{repo}/issues/{issue_number}/reactions',
  },
  {
    toolId: 'add_issue_comment',
    args: {issue_number: 1, reaction: '+1', body: 'Comment'},
    expectedRoute: 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
  },
  {
    toolId: 'add_issue_comment',
    args: {comment_id: 1, reaction: '+1'},
    expectedRoute: 'POST /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions',
  },
  {
    toolId: 'issue_write',
    method: 'create',
    args: {},
    expectedRoute: 'POST /repos/{owner}/{repo}/issues',
  },
  {
    toolId: 'issue_write',
    method: 'update',
    args: {issue_number: 1},
    expectedRoute: 'PATCH /repos/{owner}/{repo}/issues/{issue_number}',
  },
  {
    toolId: 'sub_issue_write',
    method: 'add',
    args: {issue_number: 1},
    expectedRoute: 'POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
  },
  {
    toolId: 'sub_issue_write',
    method: 'remove',
    args: {issue_number: 1, sub_issue_id: 2},
    expectedRoute: 'DELETE /repos/{owner}/{repo}/issues/{issue_number}/sub_issues/{sub_issue_id}',
  },
  {
    toolId: 'sub_issue_write',
    method: 'reprioritize',
    args: {issue_number: 1, sub_issue_id: 2, after_id: 3},
    expectedRoute: 'PATCH /repos/{owner}/{repo}/issues/{issue_number}/sub_issues/priority',
  },
  {
    toolId: 'pull_request_read',
    method: 'get',
    args: {pull_number: 1},
    expectedRoute: 'GET /repos/{owner}/{repo}/pulls/{pull_number}',
  },
  {
    toolId: 'pull_request_read',
    method: 'get_diff',
    args: {pull_number: 1},
    expectedRoute: 'GET /repos/{owner}/{repo}/pulls/{pull_number}',
  },
  {
    toolId: 'pull_request_read',
    method: 'get_status',
    args: {pull_number: 1, ref: 'main'},
    expectedRoute: 'GET /repos/{owner}/{repo}/commits/{ref}/status',
  },
  {
    toolId: 'pull_request_read',
    method: 'get_files',
    args: {pull_number: 1},
    expectedRoute: 'GET /repos/{owner}/{repo}/pulls/{pull_number}/files',
  },
  {
    toolId: 'pull_request_read',
    method: 'get_commits',
    args: {pull_number: 1},
    expectedRoute: 'GET /repos/{owner}/{repo}/pulls/{pull_number}/commits',
  },
  {
    toolId: 'pull_request_read',
    method: 'get_review_comments',
    args: {pull_number: 1},
    expectedRoute: 'GET /repos/{owner}/{repo}/pulls/{pull_number}/comments',
  },
  {
    toolId: 'pull_request_read',
    method: 'get_review_threads',
    args: {pull_number: 1},
    expectedRoute: 'POST /graphql',
  },
  {
    toolId: 'pull_request_read',
    method: 'get_reviews',
    args: {pull_number: 1},
    expectedRoute: 'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
  },
  {
    toolId: 'pull_request_read',
    method: 'get_comments',
    args: {pull_number: 1},
    expectedRoute: 'GET /repos/{owner}/{repo}/issues/{pull_number}/comments',
  },
  {
    toolId: 'pull_request_read',
    method: 'get_check_runs',
    args: {pull_number: 1, ref: 'main'},
    expectedRoute: 'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
  },
  {
    toolId: 'list_pull_requests',
    args: {},
    expectedRoute: 'GET /repos/{owner}/{repo}/pulls',
  },
  {
    toolId: 'search_pull_requests',
    args: {},
    expectedRoute: 'GET /search/issues',
  },
  {
    toolId: 'create_pull_request',
    args: {},
    expectedRoute: 'POST /repos/{owner}/{repo}/pulls',
  },
  {
    toolId: 'update_pull_request',
    args: {pull_number: 1},
    expectedRoute: 'PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
  },
  {
    toolId: 'add_reply_to_pull_request_comment',
    args: {pull_number: 1, comment_id: 2, body: 'Reply'},
    expectedRoute: 'POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies',
  },
  {
    toolId: 'add_reply_to_pull_request_comment',
    args: {comment_id: 2, reaction: '+1'},
    expectedRoute: 'POST /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions',
  },
  {
    toolId: 'merge_pull_request',
    args: {pull_number: 1},
    expectedRoute: 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge',
  },
  {
    toolId: 'update_pull_request_branch',
    args: {pull_number: 1},
    expectedRoute: 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch',
  },
  {
    toolId: 'pull_request_review_write',
    method: 'create',
    args: {pull_number: 1},
    expectedRoute: 'POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
  },
  {
    toolId: 'pull_request_review_write',
    method: 'submit_pending',
    args: {pull_number: 1},
    runtimeInjectedProperties: ['review_id'],
    expectedRoute: 'POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events',
  },
  {
    toolId: 'pull_request_review_write',
    method: 'delete_pending',
    args: {pull_number: 1},
    runtimeInjectedProperties: ['review_id'],
    expectedRoute: 'DELETE /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}',
  },
  {
    toolId: 'pull_request_review_thread_write',
    method: 'resolve',
    args: {thread_id: 'PRRT_kwDOExample'},
    expectedRoute: 'POST /graphql',
  },
  {
    toolId: 'add_comment_to_pending_review',
    args: {pull_number: 1, path: 'src/index.ts', body: 'Comment'},
    expectedRoute: 'POST /graphql',
  },
  {
    toolId: 'actions_list',
    method: 'list_workflows',
    args: {},
    expectedRoute: 'GET /repos/{owner}/{repo}/actions/workflows',
  },
  {
    toolId: 'actions_list',
    method: 'list_workflow_runs',
    args: {resource_id: 'workflow'},
    expectedRoute: 'GET /repos/{owner}/{repo}/actions/workflows/{resource_id}/runs',
  },
  {
    toolId: 'actions_list',
    method: 'list_workflow_jobs',
    args: {resource_id: 'run'},
    expectedRoute: 'GET /repos/{owner}/{repo}/actions/runs/{resource_id}/jobs',
  },
  {
    toolId: 'actions_list',
    method: 'list_workflow_run_artifacts',
    args: {resource_id: 'run'},
    expectedRoute: 'GET /repos/{owner}/{repo}/actions/runs/{resource_id}/artifacts',
  },
  {
    toolId: 'actions_get',
    method: 'get_workflow',
    args: {resource_id: 'workflow'},
    expectedRoute: 'GET /repos/{owner}/{repo}/actions/workflows/{resource_id}',
  },
  {
    toolId: 'actions_get',
    method: 'get_workflow_run',
    args: {resource_id: 'run'},
    expectedRoute: 'GET /repos/{owner}/{repo}/actions/runs/{resource_id}',
  },
  {
    toolId: 'actions_get',
    method: 'get_workflow_job',
    args: {resource_id: 'job'},
    expectedRoute: 'GET /repos/{owner}/{repo}/actions/jobs/{resource_id}',
  },
  {
    toolId: 'actions_get',
    method: 'download_workflow_run_artifact',
    args: {resource_id: 'artifact'},
    expectedRoute: 'GET /repos/{owner}/{repo}/actions/artifacts/{resource_id}/zip',
  },
  {
    toolId: 'actions_get',
    method: 'get_workflow_run_usage',
    args: {resource_id: 'run'},
    expectedRoute: 'GET /repos/{owner}/{repo}/actions/runs/{resource_id}/timing',
  },
  {
    toolId: 'actions_get',
    method: 'get_workflow_run_logs_url',
    args: {resource_id: 'run'},
    expectedRoute: 'GET /repos/{owner}/{repo}/actions/runs/{resource_id}/logs',
  },
  {
    toolId: 'actions_run_trigger',
    method: 'run_workflow',
    args: {workflow_id: 'ci.yml', ref: 'main'},
    expectedRoute: 'POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches',
  },
  {
    toolId: 'actions_run_trigger',
    method: 'rerun_workflow_run',
    args: {run_id: 1},
    expectedRoute: 'POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun',
  },
  {
    toolId: 'actions_run_trigger',
    method: 'rerun_failed_jobs',
    args: {run_id: 1},
    expectedRoute: 'POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs',
  },
  {
    toolId: 'actions_run_trigger',
    method: 'cancel_workflow_run',
    args: {run_id: 1},
    expectedRoute: 'POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel',
  },
  {
    toolId: 'actions_run_trigger',
    method: 'delete_workflow_run_logs',
    args: {run_id: 1},
    expectedRoute: 'DELETE /repos/{owner}/{repo}/actions/runs/{run_id}/logs',
  },
  {
    toolId: 'get_job_logs',
    args: {job_id: 1},
    expectedRoute: 'GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs',
  },
] satisfies readonly GithubOperationRouteCase[];

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

  it('covers every catalog operation with an exact route case', () => {
    const catalogOperationKeys = githubAgentToolCatalog.flatMap(
      (entry) =>
        entry.methods?.map((method) => operationKey(entry.id, method.id)) ?? [
          operationKey(entry.id),
        ],
    );
    const routeCaseOperationKeys = githubOperationRouteCases.map(({toolId, method}) =>
      operationKey(toolId, method),
    );

    expect([...new Set(routeCaseOperationKeys)].sort()).toEqual(
      [...new Set(catalogOperationKeys)].sort(),
    );
  });

  it.each(
    githubOperationRouteCases,
  )('asserts the $toolId.$method route and its input placeholders', ({
    toolId,
    method,
    args,
    expectedRoute,
    runtimeInjectedProperties = [],
  }) => {
    const route = githubOperationRoute(toolId, method, args);

    expect(route).toBe(expectedRoute);
    if (route === undefined) return;

    const inputProperties = new Set(Object.keys(inputSchemaFor(toolId).properties ?? {}));
    const undeclaredArguments = Object.keys(args).filter((name) => !inputProperties.has(name));
    expect(undeclaredArguments).toEqual([]);

    const projectedParameters = projectGithubOperationParameters(toolId, method, args);
    const injectedProperties = new Set([
      ...runtimeInjectedProperties,
      ...Object.keys(projectedParameters).filter(
        (name) => !inputProperties.has(name) && !Object.hasOwn(args, name),
      ),
    ]);
    const placeholders = Array.from(route.matchAll(/\{([^{}]+)\}/g), (match) => match[1]).filter(
      (name): name is string => name !== undefined,
    );
    const undeclaredPlaceholders = placeholders.filter(
      (name) => !inputProperties.has(name) && !injectedProperties.has(name),
    );

    expect(undeclaredPlaceholders).toEqual([]);
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
      {properties: {method: {const: 'get_review_threads'}}, required: []},
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

  it('returns artifact download metadata without buffering archive bytes', async () => {
    const request = vi.fn(() =>
      Promise.resolve({
        status: 302,
        headers: {
          location: 'https://objects.example/artifact.zip?token=temporary',
          'content-type': 'application/zip',
          'content-length': '1234',
        },
        data: new ArrayBuffer(1024),
      }),
    );
    const result = await callGithubToolWithRequest(
      'actions_get',
      {
        method: 'download_workflow_run_artifact',
        owner: 'shipfox',
        repo: 'platform',
        resource_id: '42',
      },
      request,
    );
    const expected = {
      archive_format: 'zip',
      download_url: 'https://objects.example/artifact.zip?token=temporary',
      artifact_id: '42',
      content_type: 'application/zip',
      size_bytes: 1234,
    };

    expect(request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/actions/artifacts/{resource_id}/zip',
      {owner: 'shipfox', repo: 'platform', resource_id: '42'},
    );
    expect(result).toEqual({
      content: [{type: 'text', text: JSON.stringify(expected)}],
      structuredContent: expected,
    });
  });

  it('fails artifact downloads without a redirect URL instead of returning an empty success', async () => {
    const result = await callGithubToolWithRequest(
      'actions_get',
      {
        method: 'download_workflow_run_artifact',
        owner: 'shipfox',
        repo: 'platform',
        resource_id: '42',
      },
      vi.fn(() =>
        Promise.resolve({
          status: 302,
          headers: {},
          data: new ArrayBuffer(0),
        }),
      ),
    );

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'GitHub artifact download did not return a download URL'}],
      structuredContent: {code: 'malformed-provider-response'},
    });
  });

  it('projects get_diff request headers through the provider session', async () => {
    const request = vi.fn(() => Promise.resolve({data: 'diff --git a/file b/file'}));
    const result = await callGithubToolWithRequest(
      'pull_request_read',
      {
        method: 'get_diff',
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
      },
      request,
    );

    expect(request).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner: 'shipfox',
      repo: 'platform',
      pull_number: 2,
      headers: {accept: 'application/vnd.github.diff'},
    });
    expect(result).toEqual({
      content: [{type: 'text', text: '{"result":"diff --git a/file b/file"}'}],
      structuredContent: {result: 'diff --git a/file b/file'},
    });
  });

  it('reads pull request review threads through GraphQL', async () => {
    const request = vi.fn();
    const data = {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [
              {
                id: 'PRRT_kwDOExample',
                isResolved: false,
                comments: {
                  nodes: [
                    {
                      id: 'PRRC_kwDOExample',
                      databaseId: 7,
                      body: 'Please handle this.',
                      author: {login: 'reviewer'},
                      path: 'src/index.ts',
                      line: 42,
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    };
    const graphql = vi.fn().mockResolvedValueOnce(data);
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [pullRequestReadTool()],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'pull_request_read',
      arguments: {
        method: 'get_review_threads',
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        cursor: 'cursor-1',
      },
    });

    expect(request).not.toHaveBeenCalled();
    expect(graphql).toHaveBeenCalledWith(
      expect.stringContaining('reviewThreads(first: 100, after: $after)'),
      {owner: 'shipfox', repo: 'platform', pullNumber: 2, after: 'cursor-1'},
    );
    const query = graphql.mock.calls[0]?.[0];
    expect(query).toContain('isResolved');
    expect(query).toContain('author');
    expect(query).toContain('path');
    expect(query).toContain('line');
    expect(result).toEqual({
      content: [{type: 'text', text: JSON.stringify(data)}],
      structuredContent: data,
    });
  });

  it('resolves a pull request review thread through GraphQL', async () => {
    const request = vi.fn();
    const data = {
      resolveReviewThread: {
        thread: {id: 'PRRT_kwDOExample', isResolved: true},
      },
    };
    const graphql = vi.fn().mockResolvedValueOnce(data);
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [pullRequestReviewThreadWriteTool()],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'pull_request_review_thread_write',
      arguments: {
        method: 'resolve',
        owner: 'shipfox',
        repo: 'platform',
        thread_id: 'PRRT_kwDOExample',
      },
    });

    expect(request).not.toHaveBeenCalled();
    expect(graphql).toHaveBeenCalledWith(expect.stringContaining('resolveReviewThread'), {
      input: {threadId: 'PRRT_kwDOExample'},
    });
    expect(result).toEqual({
      content: [{type: 'text', text: JSON.stringify(data)}],
      structuredContent: data,
    });
  });

  it('projects issue comment reactions through the provider session', async () => {
    const request = vi.fn(() => Promise.resolve({data: {id: 7}}));
    const result = await callGithubToolWithRequest(
      'add_issue_comment',
      {owner: 'shipfox', repo: 'platform', issue_number: 1, reaction: '+1'},
      request,
    );

    expect(request).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/reactions',
      {owner: 'shipfox', repo: 'platform', issue_number: 1, content: '+1'},
    );
    expect(result).toEqual({
      content: [{type: 'text', text: '{"id":7}'}],
      structuredContent: {id: 7},
    });
  });

  it('adds a comment to the latest caller pending review through GraphQL', async () => {
    const request = vi.fn().mockResolvedValueOnce({
      data: [
        {id: 40, node_id: 'review-older', state: 'PENDING', user: githubAppReviewUser},
        {id: 41, node_id: 'review-latest', state: 'PENDING', user: githubAppReviewUser},
        {
          id: 42,
          node_id: 'another-review',
          state: 'PENDING',
          user: {login: 'another-user'},
        },
      ],
    });
    const graphql = vi.fn().mockResolvedValueOnce({
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

    expect(request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
      expect.objectContaining({
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        per_page: 100,
        page: 1,
      }),
    );
    expect(request.mock.calls[0]?.[1]).toHaveProperty('request.signal');
    expect(graphql).toHaveBeenCalledWith(expect.stringContaining('addPullRequestReviewThread'), {
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
    });
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
    const request = vi.fn().mockResolvedValueOnce({
      data: [
        {
          id: 41,
          node_id: 'another-review',
          state: 'PENDING',
          user: {login: 'another-user'},
        },
      ],
    });
    const graphql = vi.fn();
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

    expect(request).toHaveBeenCalledOnce();
    expect(graphql).not.toHaveBeenCalled();
    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'No pending pull request review found for the authenticated GitHub user.',
        },
      ],
      structuredContent: {code: 'provider-rejected'},
    });
  });

  it('returns an access-denied code when the installation lacks a required permission', async () => {
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {
        getInstallationAccessToken: vi.fn(() =>
          Promise.resolve({
            token: 'installation-token',
            expiresAt: new Date(),
            permissions: {},
          }),
        ),
      },
    });
    const tool = githubAgentToolCatalog.find((entry) => entry.id === 'list_issues');
    if (!tool) throw new Error('Missing list_issues tool');
    const session = await provider.openSession({
      connection: connection(),
      tools: [tool],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'list_issues',
      arguments: {owner: 'shipfox', repo: 'platform'},
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'GitHub installation token is missing permission for this operation',
        },
      ],
      structuredContent: {code: 'access-denied'},
    });
  });

  it('passes hasGrantedPermissions against a scoped token granted permissions', async () => {
    const request = vi.fn(() => Promise.resolve({data: {merged: true}}));
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {
        getInstallationAccessToken: vi.fn(() =>
          Promise.resolve({
            token: 'scoped-installation-token',
            expiresAt: new Date(),
            permissions: {contents: 'write' as const, pull_requests: 'write' as const},
          }),
        ),
      },
      createClient: vi.fn(() => ({request})),
    });
    const tool = githubAgentToolCatalog.find((entry) => entry.id === 'merge_pull_request');
    if (!tool) throw new Error('Missing merge_pull_request tool');
    const session = await provider.openSession({
      connection: connection(),
      tools: [tool],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'merge_pull_request',
      arguments: {owner: 'shipfox', repo: 'platform', pull_number: 1},
    });

    expect(request).toHaveBeenCalledWith('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', {
      owner: 'shipfox',
      repo: 'platform',
      pull_number: 1,
    });
    expect(result).toEqual({
      content: [{type: 'text', text: '{"merge":{"merged":true}}'}],
      structuredContent: {merge: {merged: true}},
    });
  });

  it('rejects a token granting a subset of the required permissions', async () => {
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {
        getInstallationAccessToken: vi.fn(() =>
          Promise.resolve({
            token: 'scoped-installation-token',
            expiresAt: new Date(),
            permissions: {pull_requests: 'write' as const},
          }),
        ),
      },
    });
    const tool = githubAgentToolCatalog.find((entry) => entry.id === 'merge_pull_request');
    if (!tool) throw new Error('Missing merge_pull_request tool');
    const session = await provider.openSession({
      connection: connection(),
      tools: [tool],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'merge_pull_request',
      arguments: {owner: 'shipfox', repo: 'platform', pull_number: 1},
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'GitHub installation token is missing permission for this operation',
        },
      ],
      structuredContent: {code: 'access-denied'},
    });
  });

  it('rejects a pending review without a GraphQL node ID', async () => {
    const request = vi.fn().mockResolvedValueOnce({
      data: [{id: 41, state: 'PENDING', user: githubAppReviewUser}],
    });
    const graphql = vi.fn();
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [pendingReviewTool()],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'add_comment_to_pending_review',
        arguments: {
          owner: 'shipfox',
          repo: 'platform',
          pull_number: 2,
          path: 'src/agent-tools.ts',
          body: 'Please handle this error.',
        },
      }),
    ).rejects.toMatchObject({
      reason: 'malformed-provider-response',
      message: 'GitHub pending pull request review did not include a node ID',
    });
    expect(graphql).not.toHaveBeenCalled();
  });

  it('skips a malformed newer review for an older valid caller review', async () => {
    const request = vi.fn().mockResolvedValueOnce({
      data: [
        {
          id: 40,
          node_id: 'review-valid',
          state: 'PENDING',
          user: githubAppReviewUser,
        },
        {id: 41, node_id: '   ', state: 'PENDING', user: githubAppReviewUser},
      ],
    });
    const graphql = vi.fn().mockResolvedValueOnce({
      addPullRequestReviewThread: {thread: {id: 'thread-1'}},
    });
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [pendingReviewTool()],
      scope: undefined,
    });

    await session.call({
      toolId: 'add_comment_to_pending_review',
      arguments: {
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        path: 'src/agent-tools.ts',
        body: 'Please handle this error.',
      },
    });

    expect(graphql).toHaveBeenCalledWith(expect.stringContaining('addPullRequestReviewThread'), {
      input: expect.objectContaining({pullRequestReviewId: 'review-valid'}),
    });
  });

  it('rejects a malformed pending review list response', async () => {
    const request = vi.fn().mockResolvedValueOnce({data: {reviews: []}});
    const graphql = vi.fn();
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [pendingReviewTool()],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'add_comment_to_pending_review',
        arguments: {
          owner: 'shipfox',
          repo: 'platform',
          pull_number: 2,
          path: 'src/agent-tools.ts',
          body: 'Please handle this error.',
        },
      }),
    ).rejects.toMatchObject({
      reason: 'malformed-provider-response',
      message: 'GitHub pull request review list response was malformed',
    });
    expect(graphql).not.toHaveBeenCalled();
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
      structuredContent: {code: 'invalid-request'},
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
          {id: 41, state: 'PENDING', user: githubAppReviewUser},
          {id: 42, state: 'PENDING', user: githubAppReviewUser},
          {id: 43, state: 'PENDING', user: {login: 'another-user'}},
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
      expect.objectContaining({
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        per_page: 100,
        page: 1,
      }),
    );
    expect(request).toHaveBeenNthCalledWith(2, testCase.route, testCase.parameters);
  });

  it('resolves a pending review from a later review page', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          ...Array.from({length: 99}, (_, index) => ({id: index + 1, state: 'APPROVED'})),
          {id: 100, state: 'PENDING', user: githubAppReviewUser},
        ],
        headers: {
          link: '<https://api.github.com/repositories/1/pulls/2/reviews?per_page=100&page=2>; rel="last"',
        },
      })
      .mockResolvedValueOnce({
        data: [{id: 101, state: 'PENDING', user: githubAppReviewUser}],
      })
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
      expect.objectContaining({
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        per_page: 100,
        page: 1,
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
      expect.objectContaining({
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        per_page: 100,
        page: 2,
      }),
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

  it('bounds pending review lookup to the newest review pages', async () => {
    const request = vi.fn().mockResolvedValue({data: []});
    request.mockResolvedValueOnce({
      data: Array.from({length: 100}, (_, index) => ({id: index + 1, state: 'APPROVED'})),
      headers: {
        link: '<https://api.github.com/repositories/1/pulls/2/reviews?per_page=100&page=6>; rel="last"',
      },
    });

    await expect(
      callGithubToolWithRequest(
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
      ),
    ).rejects.toMatchObject({
      reason: 'content-too-large',
      message: 'GitHub pull request review history exceeded the pending review lookup limit',
    });
    expect(request).toHaveBeenCalledTimes(5);
    expect(request.mock.calls.map((call) => call[1]?.page)).toEqual([1, 6, 5, 4, 3]);
  });

  it.each([0, -1])('rejects non-positive pending review ID %s', async (id) => {
    const request = vi.fn().mockResolvedValueOnce({
      data: [{id, state: 'PENDING', user: githubAppReviewUser}],
    });

    await expect(
      callGithubToolWithRequest(
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
      ),
    ).rejects.toMatchObject({
      reason: 'malformed-provider-response',
      message: 'GitHub pending pull request review did not include a numeric ID',
    });
    expect(request).toHaveBeenCalledOnce();
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
      structuredContent: {code: 'provider-rejected'},
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

function pullRequestReadTool() {
  const tool = githubAgentToolCatalog.find((entry) => entry.id === 'pull_request_read');
  if (!tool) throw new Error('Missing pull_request_read tool');
  return tool;
}

function pullRequestReviewThreadWriteTool() {
  const tool = githubAgentToolCatalog.find(
    (entry) => entry.id === 'pull_request_review_thread_write',
  );
  if (!tool) throw new Error('Missing pull_request_review_thread_write tool');
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
    listRepositoryCommits: vi.fn(() => Promise.reject(new Error('not used'))),
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

function operationKey(toolId: GithubAgentToolId, method?: string) {
  return `${toolId}.${method ?? ''}`;
}
