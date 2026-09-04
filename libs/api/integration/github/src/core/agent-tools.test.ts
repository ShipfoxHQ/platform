import {
  assertAgentToolCatalogRepositoryScopes,
  MAX_REPOSITORY_FILE_BYTES,
} from '@shipfox/api-integration-spi';
import {RequestError} from 'octokit';
import type {GithubApiClient} from '#api/client.js';
import {DEFAULT_JOB_LOG_TAIL_LINES} from '#core/actions-logs.js';
import {
  CREATE_COMMIT_ON_BRANCH_MUTATION,
  type GithubAgentToolId,
  GithubAgentToolsProvider,
  type GithubToolClient,
  githubAgentToolCatalog,
  githubAgentToolSelectionCatalog,
  githubOperationRoute,
  githubRepositoryScope,
  projectGithubOperationParameters,
} from '#core/agent-tools.js';
import {GithubIntegrationProviderError} from '#core/errors.js';
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
    requiredScope: [
      {permission: 'issues', access: 'write'},
      {permission: 'pull_requests', access: 'write'},
    ],
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
      {permission: 'contents', access: 'read'},
      {permission: 'statuses', access: 'read'},
      {permission: 'checks', access: 'read'},
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
    id: 'create_commit',
    category: 'repository',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'contents', access: 'write'}],
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
    requiredScope: [
      {permission: 'pull_requests', access: 'write'},
      {permission: 'contents', access: 'write'},
    ],
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
  {
    id: 'create_branch',
    category: 'repository',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [{permission: 'contents', access: 'write'}],
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
    expectedRoute: 'DELETE /repos/{owner}/{repo}/issues/{issue_number}/sub_issue',
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
    toolId: 'create_commit',
    args: {},
    expectedRoute: 'POST /graphql',
  },
  {
    toolId: 'create_branch',
    args: {
      repository: 'shipfox/platform',
      branch: 'feature',
      from: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
    },
    runtimeInjectedProperties: ['owner', 'repo'],
    expectedRoute: 'POST /repos/{owner}/{repo}/git/refs',
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

  it('classifies every catalog entry with a pure repository scope classifier', () => {
    const issueRead = githubAgentToolCatalog.find((entry) => entry.id === 'issue_read');
    const issueTypes = githubAgentToolCatalog.find((entry) => entry.id === 'list_issue_types');
    const searchIssues = githubAgentToolCatalog.find((entry) => entry.id === 'search_issues');
    const searchPullRequests = githubAgentToolCatalog.find(
      (entry) => entry.id === 'search_pull_requests',
    );
    const reviewThread = githubAgentToolCatalog.find(
      (entry) => entry.id === 'pull_request_review_thread_write',
    );
    const subIssue = githubAgentToolCatalog.find((entry) => entry.id === 'sub_issue_write');
    const updateBranch = githubAgentToolCatalog.find(
      (entry) => entry.id === 'update_pull_request_branch',
    );

    expect(issueRead?.repositoryScope({owner: 'shipfox', repo: 'platform'})).toEqual({
      kind: 'declared-targets',
      repositories: [{owner: 'shipfox', name: 'platform'}],
    });
    expect(issueTypes?.repositoryScope({owner: 'shipfox'})).toEqual({kind: 'connection'});
    expect(issueTypes?.repositoryScope({owner: 'shipfox', repo: 'platform'})).toEqual({
      kind: 'declared-targets',
      repositories: [{owner: 'shipfox', name: 'platform'}],
    });
    expect(searchIssues?.repositoryScope({query: 'is:open'})).toEqual({
      kind: 'connection',
      requiresExplicitRepository: true,
      indirectTargetNote:
        'The free-form query may match results in repositories other than the declared target.',
    });
    expect(
      searchPullRequests?.repositoryScope({
        query: 'is:open',
        owner: 'shipfox',
        repo: 'platform',
      }),
    ).toEqual({
      kind: 'declared-targets',
      repositories: [{owner: 'shipfox', name: 'platform'}],
    });
    expect(
      reviewThread?.repositoryScope({
        owner: 'shipfox',
        repo: 'platform',
        thread_id: 'PRRT_kwDOExample',
      }),
    ).toEqual({kind: 'connection'});
    expect(
      subIssue?.repositoryScope({
        owner: 'shipfox',
        repo: 'platform',
        issue_number: 1,
        sub_issue_id: 2,
      }),
    ).toEqual({
      kind: 'declared-targets',
      repositories: [{owner: 'shipfox', name: 'platform'}],
    });
    expect(
      updateBranch?.repositoryScope({
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 1,
      }),
    ).toEqual({
      kind: 'declared-targets',
      repositories: [{owner: 'shipfox', name: 'platform'}],
    });
  });

  it('returns every explicit repository coordinate', () => {
    expect(
      githubRepositoryScope({
        owner: 'shipfox',
        repo: 'platform',
        base_owner: 'acme',
        base_repo: 'api',
        repository: 'tools/cli',
      }),
    ).toEqual({
      kind: 'declared-targets',
      repositories: [
        {owner: 'shipfox', name: 'platform'},
        {owner: 'acme', name: 'api'},
        {owner: 'tools', name: 'cli'},
      ],
    });
  });

  it('passes the repository classification exhaustiveness check', () => {
    expect(() => assertAgentToolCatalogRepositoryScopes(githubAgentToolCatalog)).not.toThrow();
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
    const createCommitSchema = inputSchemaFor('create_commit');
    const searchIssuesSchema = inputSchemaFor('search_issues');
    const searchPullRequestsSchema = inputSchemaFor('search_pull_requests');

    expect(listIssueTypesSchema.required).toEqual(['owner', 'repo']);
    const repositoryProperties = {
      owner: {description: 'Repository owner', type: 'string'},
      repo: {description: 'Repository name', type: 'string'},
    };
    const searchRepositoryPairSchema = [
      {properties: repositoryProperties, required: ['owner', 'repo']},
      {
        not: {
          anyOf: [
            {properties: repositoryProperties, required: ['owner']},
            {properties: repositoryProperties, required: ['repo']},
          ],
        },
      },
    ];
    expect(searchIssuesSchema.oneOf).toEqual(searchRepositoryPairSchema);
    expect(searchPullRequestsSchema.oneOf).toEqual(searchRepositoryPairSchema);
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
    expect(createCommitSchema.required).toEqual([
      'repository',
      'branch',
      'expected_head_oid',
      'message',
    ]);
    expect(createCommitSchema.properties?.message).toMatchObject({
      type: 'object',
      required: ['headline'],
    });
    expect(createCommitSchema.properties?.additions).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'contents'],
        properties: {
          encoding: {type: 'string', enum: ['utf8', 'base64']},
        },
      },
    });
    expect(createCommitSchema.properties?.deletions).toMatchObject({
      type: 'array',
      items: {type: 'object', required: ['path']},
    });
  });

  it('exposes the catalog through the provider adapter', () => {
    const provider = createProvider();
    const catalog = provider.adapters.agent_tools?.catalog();
    const selectionCatalog = provider.adapters.agent_tools?.selectionCatalog();

    expect(provider.adapters.agent_tools).toBeDefined();
    expect(provider.repositoryAuthorization).toBe('unclassified');
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

  it.each([
    {toolId: 'search_issues', outputKey: 'issues'},
    {toolId: 'search_pull_requests', outputKey: 'pull_requests'},
  ] as const)('builds a server-owned repository-scoped $toolId query', async ({
    toolId,
    outputKey,
  }) => {
    const request = vi.fn(() => Promise.resolve({data: {items: []}}));

    const result = await callGithubToolWithRequest(
      toolId,
      {
        query: 'is:open',
        owner: 'shipfox',
        repo: 'platform',
        sort: 'updated',
        order: 'desc',
        page: 2,
        per_page: 20,
      },
      request,
    );

    expect(result).toMatchObject({structuredContent: {[outputKey]: []}});
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('GET /search/issues', {
      q: 'is:open repo:shipfox/platform',
      sort: 'updated',
      order: 'desc',
      page: 2,
      per_page: 20,
    });
  });

  it.each([
    'search_issues',
    'search_pull_requests',
  ] as const)('projects an unpaired $0 search without repository parameters', async (toolId) => {
    const request = vi.fn(() => Promise.resolve({data: {items: []}}));

    await callGithubToolWithRequest(toolId, {query: 'is:open', page: 2, per_page: 20}, request);

    expect(request).toHaveBeenCalledWith('GET /search/issues', {
      q: 'is:open',
      page: 2,
      per_page: 20,
    });
  });

  it.each([
    {toolId: 'search_issues', query: ''},
    {toolId: 'search_issues', query: '   '},
    {toolId: 'search_pull_requests', query: ''},
    {toolId: 'search_pull_requests', query: '   '},
  ] as const)('rejects an empty query for $toolId', async ({toolId, query}) => {
    const request = vi.fn();
    const result = await callGithubToolWithRequest(toolId, {query}, request);

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'Parameter query must be a non-empty string'}],
      structuredContent: {code: 'invalid-request'},
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    'search_issues',
    'search_pull_requests',
  ] as const)('allows scope-like text inside quoted $0 searches', async (toolId) => {
    const request = vi.fn(() => Promise.resolve({data: {items: []}}));
    const query = 'label:"org:planning" "repo:managers"';

    await callGithubToolWithRequest(toolId, {query, owner: 'shipfox', repo: 'platform'}, request);

    expect(request).toHaveBeenCalledWith('GET /search/issues', {
      q: [query, 'repo:shipfox/platform'].join(' '),
    });
  });

  it.each([
    {toolId: 'search_issues', qualifier: 'repo:other/repository'},
    {toolId: 'search_issues', qualifier: 'org:other-org'},
    {toolId: 'search_issues', qualifier: 'user:other-user'},
    {toolId: 'search_pull_requests', qualifier: 'repo:other/repository'},
    {toolId: 'search_pull_requests', qualifier: 'org:other-org'},
    {toolId: 'search_pull_requests', qualifier: 'user:other-user'},
  ] as const)('rejects a conflicting qualifier for $toolId', async ({toolId, qualifier}) => {
    const request = vi.fn();
    const result = await callGithubToolWithRequest(
      toolId,
      {query: `is:open ${qualifier}`, owner: 'shipfox', repo: 'platform'},
      request,
    );

    expect(result).toEqual({
      isError: true,
      content: [
        {type: 'text', text: 'Search query cannot contain repo:, org:, or user: qualifiers'},
      ],
      structuredContent: {code: 'search-qualifier-conflict'},
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    {
      toolId: 'search_issues',
      query: 'is:open ORG:other-org',
      arguments_: {owner: 'shipfox', repo: 'platform'},
    },
    {
      toolId: 'search_pull_requests',
      query: 'is:open REPO:other/repository',
      arguments_: {owner: 'shipfox', repo: 'platform'},
    },
    {
      toolId: 'search_issues',
      query: 'is:open org:other-org',
      arguments_: {},
    },
    {
      toolId: 'search_pull_requests',
      query: 'is:open USER:other-user',
      arguments_: {},
    },
  ] as const)('rejects an untrusted qualifier for $toolId', async ({toolId, query, arguments_}) => {
    const request = vi.fn();
    const result = await callGithubToolWithRequest(toolId, {query, ...arguments_}, request);

    expect(result).toEqual({
      isError: true,
      content: [
        {type: 'text', text: 'Search query cannot contain repo:, org:, or user: qualifiers'},
      ],
      structuredContent: {code: 'search-qualifier-conflict'},
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    'search_issues',
    'search_pull_requests',
  ] as const)('rejects an unpaired repository for $0', async (toolId) => {
    const request = vi.fn();
    const result = await callGithubToolWithRequest(
      toolId,
      {query: 'is:open', owner: 'shipfox'},
      request,
    );

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'Parameters owner and repo must be provided together'}],
      structuredContent: {code: 'invalid-request'},
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    {toolId: 'search_issues', field: 'owner', value: 'ship fox'},
    {toolId: 'search_issues', field: 'repo', value: 'platform/repository'},
    {toolId: 'search_issues', field: 'repo', value: 'platform:repository'},
    {toolId: 'search_pull_requests', field: 'owner', value: 'ship fox'},
    {toolId: 'search_pull_requests', field: 'repo', value: 'platform/repository'},
    {toolId: 'search_pull_requests', field: 'repo', value: 'platform:repository'},
  ] as const)('rejects invalid repository name parts for $toolId', async ({
    toolId,
    field,
    value,
  }) => {
    const request = vi.fn();
    const arguments_: Record<string, unknown> = {
      query: 'is:open',
      owner: 'shipfox',
      repo: 'platform',
    };
    arguments_[field] = value;

    const result = await callGithubToolWithRequest(toolId, arguments_, request);

    expect(result).toEqual({
      isError: true,
      content: [
        {type: 'text', text: 'Parameters owner and repo must be valid repository name parts'},
      ],
      structuredContent: {code: 'invalid-request'},
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('derives the token profile from live catalog ids and method allowlists', async () => {
    const request = vi.fn(() => Promise.resolve({data: {number: 1}}));
    const getInstallationAccessToken = vi.fn(() =>
      Promise.resolve({
        token: 'installation-token',
        expiresAt: new Date(),
        permissions: {
          contents: 'write' as const,
          issues: 'read' as const,
        },
      }),
    );
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {getInstallationAccessToken},
      createClient: vi.fn(() => ({request})),
    });
    const issueTool = githubAgentToolCatalog.find((entry) => entry.id === 'issue_read');
    if (!issueTool) throw new Error('Missing issue_read tool');
    const createCommit = githubAgentToolCatalog.find((entry) => entry.id === 'create_commit');
    if (!createCommit) throw new Error('Missing create_commit tool');

    const session = await provider.openSession({
      connection: connection(),
      tools: [
        {
          ...issueTool,
          requiredScope: [{permission: 'actions', access: 'write'}],
          methods: issueTool.methods?.map((method) => ({
            ...method,
            requiredScope: [{permission: 'actions', access: 'write'}],
          })),
        },
        {
          ...createCommit,
          requiredScope: [{permission: 'actions', access: 'write'}],
        },
        {
          ...createCommit,
          id: 'removed_tool',
        },
      ],
      scope: {
        tools: [
          {
            id: 'issue_read',
            methods: [{id: 'get'}, {id: 'removed_method'}],
          },
          {
            id: 'create_commit',
          },
          {
            id: 'removed_tool',
          },
        ],
      },
    });

    await expect(session.call({toolId: 'removed_tool', arguments: {}})).resolves.toMatchObject({
      isError: true,
      structuredContent: {code: 'invalid-request'},
    });
    await expect(
      session.call({
        toolId: 'issue_read',
        arguments: {method: 'removed_method', owner: 'shipfox', repo: 'platform', issue_number: 1},
      }),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {code: 'invalid-request'},
    });
    expect(getInstallationAccessToken).not.toHaveBeenCalled();

    await expect(
      session.call({
        toolId: 'issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      }),
    ).resolves.toMatchObject({structuredContent: {number: 1}});

    expect(getInstallationAccessToken).toHaveBeenCalledWith(1, undefined, {
      contents: 'write',
      issues: 'read',
    });
  });

  it('requests issue and pull request write access for issue comments', async () => {
    const request = vi.fn(() => Promise.resolve({data: {id: 7}}));
    const getInstallationAccessToken = vi.fn(() =>
      Promise.resolve({
        token: 'installation-token',
        expiresAt: new Date(),
        permissions: {
          issues: 'write' as const,
          pull_requests: 'write' as const,
        },
      }),
    );
    const addIssueComment = githubAgentToolCatalog.find(
      (entry) => entry.id === 'add_issue_comment',
    );
    if (!addIssueComment) throw new Error('Missing add_issue_comment tool');
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {getInstallationAccessToken},
      createClient: vi.fn(() => ({request})),
    });

    const session = await provider.openSession({
      connection: connection(),
      tools: [addIssueComment],
      scope: undefined,
    });
    const result = await session.call({
      toolId: 'add_issue_comment',
      arguments: {
        owner: 'shipfox',
        repo: 'platform',
        issue_number: 1,
        body: 'Comment',
      },
    });

    expect(result).toMatchObject({structuredContent: {id: 7}});
    expect(getInstallationAccessToken).toHaveBeenCalledWith(1, undefined, {
      issues: 'write',
      pull_requests: 'write',
    });
  });

  it('keeps the strongest permission when selected tools share a scope', async () => {
    const request = vi.fn(() => Promise.resolve({data: {number: 1}}));
    const getInstallationAccessToken = vi.fn(() =>
      Promise.resolve({
        token: 'installation-token',
        expiresAt: new Date(),
        permissions: {issues: 'write' as const},
      }),
    );
    const issueRead = githubAgentToolCatalog.find((entry) => entry.id === 'issue_read');
    const issueWrite = githubAgentToolCatalog.find((entry) => entry.id === 'issue_write');
    if (!issueRead || !issueWrite) throw new Error('Missing issue catalog entries');
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {getInstallationAccessToken},
      createClient: vi.fn(() => ({request})),
    });

    const session = await provider.openSession({
      connection: connection(),
      tools: [issueRead, issueWrite],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      }),
    ).resolves.toMatchObject({structuredContent: {number: 1}});

    expect(getInstallationAccessToken).toHaveBeenCalledWith(1, undefined, {issues: 'write'});
  });

  it('uses the full integration scope for a single-tool session profile', async () => {
    const request = vi.fn(() => Promise.resolve({data: {number: 1}}));
    const getInstallationAccessToken = vi.fn(() =>
      Promise.resolve({
        token: 'installation-token',
        expiresAt: new Date(),
        permissions: {issues: 'write' as const},
      }),
    );
    const issueRead = githubAgentToolCatalog.find((entry) => entry.id === 'issue_read');
    const issueWrite = githubAgentToolCatalog.find((entry) => entry.id === 'issue_write');
    if (!issueRead || !issueWrite) throw new Error('Missing issue catalog entries');
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {getInstallationAccessToken},
      createClient: vi.fn(() => ({request})),
    });

    const session = await provider.openSession({
      connection: connection(),
      tools: [issueRead],
      scope: {tools: [{id: issueRead.id}, {id: issueWrite.id}]},
    });

    await expect(
      session.call({
        toolId: 'issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      }),
    ).resolves.toMatchObject({structuredContent: {number: 1}});

    expect(getInstallationAccessToken).toHaveBeenCalledWith(1, undefined, {issues: 'write'});
  });

  it('requests checks read for check-run reads', async () => {
    const request = vi.fn(() => Promise.resolve({data: {total_count: 1}}));
    const getInstallationAccessToken = vi.fn(() =>
      Promise.resolve({
        token: 'installation-token',
        expiresAt: new Date(),
        permissions: {checks: 'read' as const},
      }),
    );
    const pullRequestRead = githubAgentToolCatalog.find(
      (entry) => entry.id === 'pull_request_read',
    );
    const checkRunsMethod = pullRequestRead?.methods?.find(
      (method) => method.id === 'get_check_runs',
    );
    if (!pullRequestRead || !checkRunsMethod) throw new Error('Missing check-run catalog entry');
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {getInstallationAccessToken},
      createClient: vi.fn(() => ({request})),
    });

    const session = await provider.openSession({
      connection: connection(),
      tools: [{...pullRequestRead, methods: [checkRunsMethod]}],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'pull_request_read',
        arguments: {
          method: 'get_check_runs',
          owner: 'shipfox',
          repo: 'platform',
          pull_number: 1,
          ref: 'abc123',
        },
      }),
    ).resolves.toMatchObject({structuredContent: {total_count: 1}});

    expect(getInstallationAccessToken).toHaveBeenCalledWith(1, undefined, {checks: 'read'});
  });

  it('requests contents read for pull request diffs', async () => {
    const request = vi.fn(() => Promise.resolve({data: 'diff --git a/file b/file'}));
    const getInstallationAccessToken = vi.fn(() =>
      Promise.resolve({
        token: 'installation-token',
        expiresAt: new Date(),
        permissions: {contents: 'read' as const},
      }),
    );
    const pullRequestRead = githubAgentToolCatalog.find(
      (entry) => entry.id === 'pull_request_read',
    );
    const diffMethod = pullRequestRead?.methods?.find((method) => method.id === 'get_diff');
    if (!pullRequestRead || !diffMethod) throw new Error('Missing diff catalog entry');
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {getInstallationAccessToken},
      createClient: vi.fn(() => ({request})),
    });

    const session = await provider.openSession({
      connection: connection(),
      tools: [{...pullRequestRead, methods: [diffMethod]}],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'pull_request_read',
        arguments: {method: 'get_diff', owner: 'shipfox', repo: 'platform', pull_number: 1},
      }),
    ).resolves.toMatchObject({structuredContent: {result: 'diff --git a/file b/file'}});

    expect(getInstallationAccessToken).toHaveBeenCalledWith(1, undefined, {contents: 'read'});
  });

  it('denies a pull request diff when the token lacks contents read', async () => {
    const request = vi.fn();
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {
        getInstallationAccessToken: vi.fn(() =>
          Promise.resolve({
            token: 'installation-token',
            expiresAt: new Date(),
            permissions: {pull_requests: 'read' as const},
          }),
        ),
      },
      createClient: vi.fn(() => ({request})),
    });
    const session = await provider.openSession({
      connection: connection(),
      tools: [pullRequestReadTool()],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'pull_request_read',
      arguments: {method: 'get_diff', owner: 'shipfox', repo: 'platform', pull_number: 1},
    });

    expect(request).not.toHaveBeenCalled();
    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'GitHub installation token is missing permission for this operation: pull_request_read requires contents: read',
        },
      ],
      structuredContent: {code: 'access-denied'},
    });
  });

  it('requests commit statuses read for combined status reads', async () => {
    const request = vi.fn(() => Promise.resolve({data: {state: 'success'}}));
    const getInstallationAccessToken = vi.fn(() =>
      Promise.resolve({
        token: 'installation-token',
        expiresAt: new Date(),
        permissions: {statuses: 'read' as const},
      }),
    );
    const pullRequestRead = githubAgentToolCatalog.find(
      (entry) => entry.id === 'pull_request_read',
    );
    const statusMethod = pullRequestRead?.methods?.find((method) => method.id === 'get_status');
    if (!pullRequestRead || !statusMethod) throw new Error('Missing combined-status catalog entry');
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {getInstallationAccessToken},
      createClient: vi.fn(() => ({request})),
    });

    const session = await provider.openSession({
      connection: connection(),
      tools: [{...pullRequestRead, methods: [statusMethod]}],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'pull_request_read',
        arguments: {
          method: 'get_status',
          owner: 'shipfox',
          repo: 'platform',
          pull_number: 1,
          ref: 'abc123',
        },
      }),
    ).resolves.toMatchObject({structuredContent: {state: 'success'}});

    expect(request).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/commits/{ref}/status', {
      owner: 'shipfox',
      repo: 'platform',
      pull_number: 1,
      ref: 'abc123',
    });
    expect(getInstallationAccessToken).toHaveBeenCalledWith(1, undefined, {statuses: 'read'});
  });

  it.each([
    {label: 'pull_requests read', permissions: {pull_requests: 'read' as const}},
    {label: 'issues read', permissions: {issues: 'read' as const}},
  ])('reads pull request timeline comments with $label', async ({permissions}) => {
    const request = vi.fn(() => Promise.resolve({data: [{id: 1}]}));
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {
        getInstallationAccessToken: vi.fn(() =>
          Promise.resolve({token: 'installation-token', expiresAt: new Date(), permissions}),
        ),
      },
      createClient: vi.fn(() => ({request})),
    });
    const pullRequestRead = githubAgentToolCatalog.find(
      (entry) => entry.id === 'pull_request_read',
    );
    if (!pullRequestRead) throw new Error('Missing pull_request_read tool');
    const session = await provider.openSession({
      connection: connection(),
      tools: [pullRequestRead],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'pull_request_read',
        arguments: {method: 'get_comments', owner: 'shipfox', repo: 'platform', pull_number: 1},
      }),
    ).resolves.toMatchObject({structuredContent: {result: [{id: 1}]}});

    expect(request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/issues/{pull_number}/comments',
      {
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 1,
      },
    );
  });

  it('names the alternative grant when pull request timeline comments are denied', async () => {
    const request = vi.fn();
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {
        getInstallationAccessToken: vi.fn(() =>
          Promise.resolve({
            token: 'installation-token',
            expiresAt: new Date(),
            permissions: {checks: 'read' as const},
          }),
        ),
      },
      createClient: vi.fn(() => ({request})),
    });
    const pullRequestRead = githubAgentToolCatalog.find(
      (entry) => entry.id === 'pull_request_read',
    );
    if (!pullRequestRead) throw new Error('Missing pull_request_read tool');
    const session = await provider.openSession({
      connection: connection(),
      tools: [pullRequestRead],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'pull_request_read',
      arguments: {method: 'get_comments', owner: 'shipfox', repo: 'platform', pull_number: 1},
    });

    expect(request).not.toHaveBeenCalled();
    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'GitHub installation token is missing permission for this operation: pull_request_read requires pull_requests: read (or issues: read)',
        },
      ],
      structuredContent: {code: 'access-denied'},
    });
  });

  it('removes a sub-issue through the singular endpoint with the child id in the body', async () => {
    const request = vi.fn(() => Promise.resolve({data: {number: 1}}));
    const provider = createAgentToolsProvider({request});
    const subIssueWrite = githubAgentToolCatalog.find((entry) => entry.id === 'sub_issue_write');
    if (!subIssueWrite) throw new Error('Missing sub_issue_write tool');
    const session = await provider.openSession({
      connection: connection(),
      tools: [subIssueWrite],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'sub_issue_write',
        arguments: {
          method: 'remove',
          owner: 'shipfox',
          repo: 'platform',
          issue_number: 1,
          sub_issue_id: 2,
        },
      }),
    ).resolves.toMatchObject({structuredContent: {number: 1}});

    expect(request).toHaveBeenCalledWith(
      'DELETE /repos/{owner}/{repo}/issues/{issue_number}/sub_issue',
      {owner: 'shipfox', repo: 'platform', issue_number: 1, sub_issue_id: 2},
    );
  });

  it.each([
    {
      toolId: 'create_pull_request' as const,
      callArguments: {
        owner: 'shipfox',
        repo: 'platform',
        title: 'Title',
        head: 'feature',
        base: 'main',
        reviewers: ['octocat', 'shipfox/reviewers'],
      },
      route: 'POST /repos/{owner}/{repo}/pulls',
      parameters: {
        owner: 'shipfox',
        repo: 'platform',
        title: 'Title',
        head: 'feature',
        base: 'main',
      },
    },
    {
      toolId: 'update_pull_request' as const,
      callArguments: {
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 7,
        reviewers: ['octocat', 'shipfox/reviewers'],
      },
      route: 'PATCH /repos/{owner}/{repo}/pulls/{pull_number}',
      parameters: {owner: 'shipfox', repo: 'platform', pull_number: 7},
    },
  ])('requests reviewers after $toolId saves the pull request', async ({
    toolId,
    callArguments,
    route,
    parameters,
  }) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({data: {number: 7}})
      .mockResolvedValueOnce({data: {number: 7, requested_reviewers: [{login: 'octocat'}]}});
    const provider = createAgentToolsProvider({request});
    const tool = githubAgentToolCatalog.find((entry) => entry.id === toolId);
    if (!tool) throw new Error(`Missing ${toolId} tool`);
    const session = await provider.openSession({
      connection: connection(),
      tools: [tool],
      scope: undefined,
    });

    const result = await session.call({toolId, arguments: callArguments});

    expect(request).toHaveBeenNthCalledWith(1, route, parameters);
    expect(request).toHaveBeenNthCalledWith(
      2,
      'POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers',
      {
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 7,
        reviewers: ['octocat'],
        team_reviewers: ['reviewers'],
      },
    );
    expect(result).toMatchObject({
      structuredContent: {pull_request: {number: 7, requested_reviewers: [{login: 'octocat'}]}},
    });
  });

  it('saves a pull request without a reviewer request when none are given', async () => {
    const request = vi.fn(() => Promise.resolve({data: {number: 7}}));
    const provider = createAgentToolsProvider({request});
    const tool = githubAgentToolCatalog.find((entry) => entry.id === 'update_pull_request');
    if (!tool) throw new Error('Missing update_pull_request tool');
    const session = await provider.openSession({
      connection: connection(),
      tools: [tool],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'update_pull_request',
        arguments: {owner: 'shipfox', repo: 'platform', pull_number: 7, title: 'Updated'},
      }),
    ).resolves.toMatchObject({structuredContent: {pull_request: {number: 7}}});

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner: 'shipfox',
      repo: 'platform',
      pull_number: 7,
      title: 'Updated',
    });
  });

  it('reports a failed reviewer request without hiding the saved pull request', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({data: {number: 7}})
      .mockRejectedValueOnce(
        new GithubIntegrationProviderError(
          'provider-rejected',
          'Reviews may only be requested from collaborators.',
          undefined,
          422,
        ),
      );
    const provider = createAgentToolsProvider({request});
    const tool = githubAgentToolCatalog.find((entry) => entry.id === 'create_pull_request');
    if (!tool) throw new Error('Missing create_pull_request tool');
    const session = await provider.openSession({
      connection: connection(),
      tools: [tool],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'create_pull_request',
        arguments: {
          owner: 'shipfox',
          repo: 'platform',
          title: 'Title',
          head: 'feature',
          base: 'main',
          reviewers: ['stranger'],
        },
      }),
    ).rejects.toMatchObject({
      reason: 'provider-rejected',
      status: 422,
      message:
        'Pull request #7 was saved but requesting reviewers failed: Reviews may only be requested from collaborators.',
    });
  });

  it('wraps a transport failure during the reviewer request with the saved pull request', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({data: {number: 7}})
      .mockRejectedValueOnce(new Error('fetch failed'));
    const provider = createAgentToolsProvider({request});
    const tool = githubAgentToolCatalog.find((entry) => entry.id === 'create_pull_request');
    if (!tool) throw new Error('Missing create_pull_request tool');
    const session = await provider.openSession({
      connection: connection(),
      tools: [tool],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'create_pull_request',
        arguments: {
          owner: 'shipfox',
          repo: 'platform',
          title: 'Title',
          head: 'feature',
          base: 'main',
          reviewers: ['octocat'],
        },
      }),
    ).rejects.toMatchObject({
      reason: 'provider-unavailable',
      message: 'Pull request #7 was saved but requesting reviewers failed: fetch failed',
    });
  });

  it('maps a reviewer request 404 to provider-rejected rather than a missing repository', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({data: {number: 7}})
      .mockRejectedValueOnce(
        new RequestError('Not Found', 404, {
          request: {
            method: 'POST',
            url: 'https://api.github.com/repos/shipfox/platform/pulls/7/requested_reviewers',
            headers: {},
          },
        }),
      );
    const provider = createAgentToolsProvider({request});
    const tool = githubAgentToolCatalog.find((entry) => entry.id === 'update_pull_request');
    if (!tool) throw new Error('Missing update_pull_request tool');
    const session = await provider.openSession({
      connection: connection(),
      tools: [tool],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'update_pull_request',
        arguments: {owner: 'shipfox', repo: 'platform', pull_number: 7, reviewers: ['octocat']},
      }),
    ).rejects.toMatchObject({
      reason: 'provider-rejected',
      status: 404,
      message: 'Pull request #7 was saved but requesting reviewers failed: Not Found',
    });
  });

  it('reports a saved pull request whose number is missing instead of requesting reviewers', async () => {
    const request = vi.fn().mockResolvedValueOnce({data: {}});
    const provider = createAgentToolsProvider({request});
    const tool = githubAgentToolCatalog.find((entry) => entry.id === 'create_pull_request');
    if (!tool) throw new Error('Missing create_pull_request tool');
    const session = await provider.openSession({
      connection: connection(),
      tools: [tool],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'create_pull_request',
        arguments: {
          owner: 'shipfox',
          repo: 'platform',
          title: 'Title',
          head: 'feature',
          base: 'main',
          reviewers: ['octocat'],
        },
      }),
    ).rejects.toMatchObject({
      reason: 'malformed-provider-response',
      message:
        'Pull request was saved but GitHub did not return its number, so reviewers were not requested',
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([
    {label: 'an empty string', reviewers: ['']},
    {label: 'a non-string entry', reviewers: [42]},
    {label: 'a team without a slug', reviewers: ['shipfox/']},
    {label: 'a team without an organization', reviewers: ['/reviewers']},
    {label: 'more than one slash', reviewers: ['shipfox/team/extra']},
    {label: 'whitespace', reviewers: ['octo cat']},
    {label: 'whitespace in a team slug', reviewers: ['shipfox/code reviewers']},
  ])('rejects reviewers containing $label before saving the pull request', async ({reviewers}) => {
    const request = vi.fn();
    const provider = createAgentToolsProvider({request});
    const tool = githubAgentToolCatalog.find((entry) => entry.id === 'update_pull_request');
    if (!tool) throw new Error('Missing update_pull_request tool');
    const session = await provider.openSession({
      connection: connection(),
      tools: [tool],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'update_pull_request',
      arguments: {owner: 'shipfox', repo: 'platform', pull_number: 7, reviewers},
    });

    expect(request).not.toHaveBeenCalled();
    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Parameter reviewers must be an array of non-empty GitHub usernames or org/team-slug strings',
        },
      ],
      structuredContent: {code: 'invalid-request'},
    });
  });

  it('rejects workflow file changes when the token lacks workflows write', async () => {
    const graphql = vi.fn();
    const provider = createAgentToolsProvider({request: vi.fn(), graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'create_commit',
      arguments: {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Add CI'},
        additions: [{path: '.github/workflows/ci.yml', contents: 'name: ci\n'}],
      },
    });

    expect(graphql).not.toHaveBeenCalled();
    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'GitHub installation token is missing permission for this operation: create_commit requires workflows: write to change .github/workflows/ci.yml',
        },
      ],
      structuredContent: {code: 'access-denied'},
    });
  });

  it.each([
    {
      label: 'a deleted workflow file',
      changes: {deletions: [{path: '.github/workflows/old.yml'}]},
      code: 'access-denied',
    },
    {
      label: 'a relative workflow path',
      changes: {additions: [{path: './.github/workflows/ci.yml', contents: 'name: ci\n'}]},
      code: 'invalid-request',
    },
    {
      label: 'a parent-traversal workflow path',
      changes: {additions: [{path: 'docs/../.github/workflows/ci.yml', contents: 'name: ci\n'}]},
      code: 'invalid-request',
    },
  ])('rejects $label when the token lacks workflows write', async ({changes, code}) => {
    const graphql = vi.fn();
    const provider = createAgentToolsProvider({request: vi.fn(), graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'create_commit',
      arguments: {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Touch CI'},
        ...changes,
      },
    });

    expect(graphql).not.toHaveBeenCalled();
    expect(result).toMatchObject({isError: true, structuredContent: {code}});
  });

  it('denies workflow file commits under the production create_commit profile', async () => {
    const graphql = vi.fn();
    const getInstallationAccessToken = vi.fn(
      (
        _installationId: number,
        _permissionFingerprint?: string,
        permissions?: Record<string, 'read' | 'write'>,
      ) =>
        Promise.resolve({
          token: 'installation-token',
          expiresAt: new Date(),
          permissions: permissions ?? {},
        }),
    );
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {getInstallationAccessToken},
      createClient: vi.fn(() => ({request: vi.fn(), graphql})),
    });
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'create_commit',
      arguments: {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Add CI'},
        additions: [{path: '.github/workflows/ci.yml', contents: 'name: ci\n'}],
      },
    });

    // The live profile never requests workflows, so the allow path stays closed until the
    // catalog scope declares it.
    expect(getInstallationAccessToken).toHaveBeenCalledWith(1, undefined, {contents: 'write'});
    expect(graphql).not.toHaveBeenCalled();
    expect(result).toMatchObject({isError: true, structuredContent: {code: 'access-denied'}});
  });

  it('commits workflow file changes only when the minted token carries workflows write', async () => {
    const oid = '0'.repeat(40);
    const graphql = vi.fn().mockResolvedValueOnce({
      createCommitOnBranch: {
        commit: {oid, url: `https://github.com/shipfox/platform/commit/${oid}`},
      },
    });
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {
        getInstallationAccessToken: vi.fn(() =>
          Promise.resolve({
            token: 'installation-token',
            expiresAt: new Date(),
            permissions: {contents: 'write' as const, workflows: 'write' as const},
          }),
        ),
      },
      createClient: vi.fn(() => ({request: vi.fn(), graphql})),
    });
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'create_commit',
        arguments: {
          repository: 'shipfox/platform',
          branch: 'feature',
          expected_head_oid: 'a'.repeat(40),
          message: {headline: 'Remove CI'},
          deletions: [{path: '.github/workflows/old.yml'}],
        },
      }),
    ).resolves.toMatchObject({structuredContent: {commit: {oid}}});

    expect(graphql).toHaveBeenCalledOnce();
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
                path: 'src/index.ts',
                line: 42,
                diffSide: 'RIGHT',
                startLine: 40,
                startDiffSide: 'RIGHT',
                comments: {
                  nodes: [
                    {
                      id: 'PRRC_kwDOExample',
                      databaseId: 7,
                      body: 'Please handle this.',
                      author: {login: 'reviewer'},
                      path: 'src/index.ts',
                      line: 42,
                      startLine: 40,
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
    const queryText = String(query);
    const threadFields = queryText
      .slice(
        queryText.indexOf('reviewThreads(first: 100, after: $after)'),
        queryText.indexOf('comments(first: 100)'),
      )
      .split('\n')
      .map((line) => line.trim());
    expect(query).toContain('isResolved');
    expect(query).toContain('author');
    expect(threadFields).toEqual(
      expect.arrayContaining(['path', 'line', 'diffSide', 'startLine', 'startDiffSide']),
    );
    const selectedFields = queryText.split('\n').map((line) => line.trim());
    expect(selectedFields).not.toContain('side');
    expect(selectedFields).not.toContain('startSide');
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

  it('creates a commit through GraphQL with utf8 contents transcoded to base64', async () => {
    const request = vi.fn();
    const data = {
      createCommitOnBranch: {
        commit: {
          oid: '0123456789abcdef0123456789abcdef01234567',
          url: 'https://github.com/shipfox/platform/commit/0123456789abcdef0123456789abcdef01234567',
        },
      },
    };
    const graphql = vi.fn().mockResolvedValueOnce(data);
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'create_commit',
      arguments: {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'fedcba9876543210fedcba9876543210fedcba98',
        message: {headline: 'Implement ENG-1719', body: 'Signed bot commits.'},
        additions: [
          {path: 'docs/README.md', contents: 'Hello, 世界!\n'},
          {path: 'config.json', contents: 'eyJmb28iOiJiYXIifQ==', encoding: 'base64'},
        ],
        deletions: [{path: 'legacy/old-file.txt'}],
      },
    });

    expect(request).not.toHaveBeenCalled();
    expect(graphql).toHaveBeenCalledWith(CREATE_COMMIT_ON_BRANCH_MUTATION, {
      input: {
        branch: {repositoryNameWithOwner: 'shipfox/platform', branchName: 'feature'},
        expectedHeadOid: 'fedcba9876543210fedcba9876543210fedcba98',
        message: {headline: 'Implement ENG-1719', body: 'Signed bot commits.'},
        fileChanges: {
          additions: [
            {
              path: 'docs/README.md',
              contents: Buffer.from('Hello, 世界!\n', 'utf8').toString('base64'),
            },
            {path: 'config.json', contents: 'eyJmb28iOiJiYXIifQ=='},
          ],
          deletions: [{path: 'legacy/old-file.txt'}],
        },
      },
    });
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            commit: {
              oid: data.createCommitOnBranch.commit.oid,
              url: data.createCommitOnBranch.commit.url,
            },
          }),
        },
      ],
      structuredContent: {
        commit: {
          oid: data.createCommitOnBranch.commit.oid,
          url: data.createCommitOnBranch.commit.url,
        },
      },
    });
  });

  it('models renames as a deletion of the old path plus an addition of the new path', async () => {
    const request = vi.fn();
    const graphql = vi.fn().mockResolvedValueOnce({
      createCommitOnBranch: {
        commit: {
          oid: 'a'.repeat(40),
          url: `https://github.com/shipfox/platform/commit/${'a'.repeat(40)}`,
        },
      },
    });
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    await session.call({
      toolId: 'create_commit',
      arguments: {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'b'.repeat(40),
        message: {headline: 'Rename file'},
        deletions: [{path: 'docs/README.md'}],
        additions: [{path: 'docs/README.txt', contents: 'Hello, 世界!\n'}],
      },
    });

    const input = graphql.mock.calls[0]?.[1];
    expect(input).toEqual({
      input: {
        branch: {repositoryNameWithOwner: 'shipfox/platform', branchName: 'feature'},
        expectedHeadOid: 'b'.repeat(40),
        message: {headline: 'Rename file'},
        fileChanges: {
          additions: [
            {
              path: 'docs/README.txt',
              contents: Buffer.from('Hello, 世界!\n', 'utf8').toString('base64'),
            },
          ],
          deletions: [{path: 'docs/README.md'}],
        },
      },
    });
  });

  it('passes base64-encoded binary contents through unchanged', async () => {
    const binaryBase64 = Buffer.from([0x00, 0x01, 0x89, 0xff, 0x10]).toString('base64');
    const request = vi.fn();
    const graphql = vi.fn().mockResolvedValueOnce({
      createCommitOnBranch: {
        commit: {
          oid: 'c'.repeat(40),
          url: `https://github.com/shipfox/platform/commit/${'c'.repeat(40)}`,
        },
      },
    });
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    await session.call({
      toolId: 'create_commit',
      arguments: {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'd'.repeat(40),
        message: {headline: 'Add binary asset'},
        additions: [{path: 'assets/logo.png', contents: binaryBase64, encoding: 'base64'}],
      },
    });

    expect(graphql.mock.calls[0]?.[1]).toEqual({
      input: {
        branch: {repositoryNameWithOwner: 'shipfox/platform', branchName: 'feature'},
        expectedHeadOid: 'd'.repeat(40),
        message: {headline: 'Add binary asset'},
        fileChanges: {
          additions: [{path: 'assets/logo.png', contents: binaryBase64}],
          deletions: [],
        },
      },
    });
  });

  it('accepts empty base64 contents as an empty file', async () => {
    const request = vi.fn();
    const graphql = vi.fn().mockResolvedValueOnce({
      createCommitOnBranch: {
        commit: {
          oid: 'c'.repeat(40),
          url: `https://github.com/shipfox/platform/commit/${'c'.repeat(40)}`,
        },
      },
    });
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    await session.call({
      toolId: 'create_commit',
      arguments: {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'd'.repeat(40),
        message: {headline: 'Add empty file'},
        additions: [{path: 'assets/empty.bin', contents: '', encoding: 'base64'}],
      },
    });

    expect(graphql.mock.calls[0]?.[1]).toEqual({
      input: {
        branch: {repositoryNameWithOwner: 'shipfox/platform', branchName: 'feature'},
        expectedHeadOid: 'd'.repeat(40),
        message: {headline: 'Add empty file'},
        fileChanges: {
          additions: [{path: 'assets/empty.bin', contents: ''}],
          deletions: [],
        },
      },
    });
  });

  it('accepts a 64-character SHA-256 oid', async () => {
    const request = vi.fn();
    const graphql = vi.fn().mockResolvedValueOnce({
      createCommitOnBranch: {
        commit: {
          oid: 'e'.repeat(64),
          url: `https://github.com/shipfox/platform/commit/${'e'.repeat(64)}`,
        },
      },
    });
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'create_commit',
      arguments: {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'f'.repeat(64),
        message: {headline: 'SHA-256 repo'},
        additions: [{path: 'docs/README.md', contents: 'content'}],
      },
    });

    expect(graphql).toHaveBeenCalledWith(CREATE_COMMIT_ON_BRANCH_MUTATION, {
      input: expect.objectContaining({expectedHeadOid: 'f'.repeat(64)}),
    });
    expect(result).toMatchObject({
      structuredContent: {commit: {oid: 'e'.repeat(64)}},
    });
  });

  it('maps an expectedHeadOid mismatch to a provider-rejected stale-head error', async () => {
    const request = vi.fn();
    const providerMessage =
      'Expected branch to point to "fedcba9876543210fedcba9876543210fedcba98" but it did not. Pull and try again.';
    const graphql = vi
      .fn()
      .mockRejectedValue(graphqlError([{type: 'STALE_DATA', message: providerMessage}]));
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'create_commit',
        arguments: {
          repository: 'shipfox/platform',
          branch: 'feature',
          expected_head_oid: 'fedcba9876543210fedcba9876543210fedcba98',
          message: {headline: 'Race'},
          additions: [{path: 'docs/README.md', contents: 'content'}],
        },
      }),
    ).rejects.toMatchObject({
      reason: 'provider-rejected',
      message:
        'Stale branch head (stale-head): expected_head_oid fedcba9876543210fedcba9876543210fedcba98 did not match the branch tip. ' +
        providerMessage,
    });
  });

  it('maps an STALE_HEAD_OID typed GraphQL error without a matching message', async () => {
    const request = vi.fn();
    const graphql = vi
      .fn()
      .mockRejectedValue(
        graphqlError([{type: 'STALE_HEAD_OID', message: 'The branch head moved'}]),
      );
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'create_commit',
        arguments: {
          repository: 'shipfox/platform',
          branch: 'feature',
          expected_head_oid: 'a'.repeat(40),
          message: {headline: 'Race'},
          additions: [{path: 'docs/README.md', contents: 'content'}],
        },
      }),
    ).rejects.toMatchObject({
      reason: 'provider-rejected',
      message: expect.stringContaining('stale-head'),
    });
  });

  it('maps a message-only expectedHeadOid mismatch to a stale-head error', async () => {
    const request = vi.fn();
    const providerMessage =
      'Expected branch to point to "0123456789abcdef0123456789abcdef01234567" but it did not. Pull and try again.';
    const graphql = vi.fn().mockRejectedValue(graphqlError([{message: providerMessage}]));
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'create_commit',
        arguments: {
          repository: 'shipfox/platform',
          branch: 'feature',
          expected_head_oid: '0123456789abcdef0123456789abcdef01234567',
          message: {headline: 'Race'},
          additions: [{path: 'docs/README.md', contents: 'content'}],
        },
      }),
    ).rejects.toMatchObject({
      reason: 'provider-rejected',
      message:
        'Stale branch head (stale-head): expected_head_oid 0123456789abcdef0123456789abcdef01234567 did not match the branch tip. ' +
        providerMessage,
    });
  });

  it('maps a RATE_LIMITED GraphQL error anywhere in the errors list with retry context', async () => {
    const request = vi.fn();
    const graphql = vi
      .fn()
      .mockRejectedValue(
        graphqlError(
          [
            {message: 'A non-classified error appears first'},
            {type: 'RATE_LIMITED', message: 'The GraphQL rate limit has been hit'},
          ],
          {status: 403, headers: {'retry-after': '60'}},
        ),
      );
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'create_commit',
        arguments: {
          repository: 'shipfox/platform',
          branch: 'feature',
          expected_head_oid: 'a'.repeat(40),
          message: {headline: 'Rate limited'},
          additions: [{path: 'docs/README.md', contents: 'content'}],
        },
      }),
    ).rejects.toMatchObject({
      reason: 'rate-limited',
      message: 'The GraphQL rate limit has been hit',
      retryAfterSeconds: 60,
      status: 403,
    });
  });

  it('surfaces unique-path violations readably', async () => {
    const request = vi.fn();
    const graphql = vi
      .fn()
      .mockRejectedValueOnce(graphqlError([{message: 'Path must be unique: docs/README.md'}]));
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'create_commit',
        arguments: {
          repository: 'shipfox/platform',
          branch: 'feature',
          expected_head_oid: 'a'.repeat(40),
          message: {headline: 'Duplicate'},
          additions: [
            {path: 'docs/README.md', contents: 'one'},
            {path: 'docs/README.md', contents: 'two'},
          ],
        },
      }),
    ).rejects.toMatchObject({
      reason: 'provider-rejected',
      message: 'Path must be unique: docs/README.md',
    });
  });

  it('surfaces nonexistent-deletion errors readably', async () => {
    const request = vi.fn();
    const message =
      'A path was requested for deletion which does not exist as of commit oid `' +
      'a'.repeat(40) +
      '`';
    const graphql = vi.fn().mockRejectedValueOnce(graphqlError([{message}]));
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'create_commit',
        arguments: {
          repository: 'shipfox/platform',
          branch: 'feature',
          expected_head_oid: 'a'.repeat(40),
          message: {headline: 'Delete'},
          deletions: [{path: 'docs/missing.md'}],
        },
      }),
    ).rejects.toMatchObject({
      reason: 'provider-rejected',
      message,
    });
  });

  it('rejects an empty change set at validation', async () => {
    const request = vi.fn();
    const graphql = vi.fn();
    const result = await callGithubToolWithRequest(
      'create_commit',
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Empty'},
      },
      request,
    );

    expect(graphql).not.toHaveBeenCalled();
    expect(result).toEqual({
      isError: true,
      content: [
        {type: 'text', text: 'At least one addition or deletion is required to create a commit'},
      ],
      structuredContent: {code: 'invalid-request'},
    });
  });

  it('rejects malformed create_commit arguments at validation', async () => {
    const request = vi.fn();
    const graphql = vi.fn();
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    const invalidCalls = [
      {
        repository: 'platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Bad repository'},
        additions: [{path: 'a.txt', contents: 'x'}],
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'not-an-oid',
        message: {headline: 'Bad oid'},
        additions: [{path: 'a.txt', contents: 'x'}],
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Bad encoding'},
        additions: [{path: 'a.txt', contents: 'x', encoding: 'hex'}],
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Bad body', body: 42},
        additions: [{path: 'a.txt', contents: 'x'}],
      },
      {
        repository: 'shipfox/platform',
        branch: '   ',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Blank branch'},
        additions: [{path: 'a.txt', contents: 'x'}],
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: 'not-an-object',
        additions: [{path: 'a.txt', contents: 'x'}],
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: '   '},
        additions: [{path: 'a.txt', contents: 'x'}],
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Bad additions type'},
        additions: 'x',
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Bad deletions type'},
        additions: [{path: 'a.txt', contents: 'x'}],
        deletions: 'x',
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Empty addition path'},
        additions: [{path: '', contents: 'x'}],
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Non-string contents'},
        additions: [{path: 'a.txt', contents: 42}],
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Empty deletion path'},
        additions: [{path: 'a.txt', contents: 'x'}],
        deletions: [{path: ''}],
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Parent traversal path'},
        additions: [{path: '../escape.txt', contents: 'x'}],
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Absolute path'},
        additions: [{path: '/etc/passwd', contents: 'x'}],
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Dotgit path'},
        additions: [{path: '.git/config', contents: 'x'}],
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Unpaired surrogate'},
        additions: [{path: 'a.txt', contents: '\uD800'}],
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Unpaired surrogate with explicit utf8'},
        additions: [{path: 'a.txt', contents: '\uD800', encoding: 'utf8'}],
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Malformed base64'},
        additions: [{path: 'a.bin', contents: 'not!base64', encoding: 'base64'}],
      },
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'Oversized contents'},
        additions: [{path: 'a.txt', contents: 'x'.repeat(MAX_REPOSITORY_FILE_BYTES + 1)}],
      },
    ];

    for (const arguments_ of invalidCalls) {
      const result = await session.call({toolId: 'create_commit', arguments: arguments_});
      expect(result).toMatchObject({isError: true, structuredContent: {code: 'invalid-request'}});
    }
    expect(graphql).not.toHaveBeenCalled();
  });

  it('rejects a create_commit call when the installation lacks contents write', async () => {
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {
        getInstallationAccessToken: vi.fn(() =>
          Promise.resolve({
            token: 'installation-token',
            expiresAt: new Date(),
            permissions: {issues: 'write' as const, pull_requests: 'write' as const},
          }),
        ),
      },
    });
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'create_commit',
      arguments: {
        repository: 'shipfox/platform',
        branch: 'feature',
        expected_head_oid: 'a'.repeat(40),
        message: {headline: 'No scope'},
        additions: [{path: 'a.txt', contents: 'x'}],
      },
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'GitHub installation token is missing permission for this operation: create_commit requires contents: write',
        },
      ],
      structuredContent: {code: 'access-denied'},
    });
  });

  it('rejects a createCommitOnBranch response without a commit', async () => {
    const request = vi.fn();
    const graphql = vi.fn().mockResolvedValueOnce({createCommitOnBranch: {commit: {}}});
    const provider = createAgentToolsProvider({request, graphql});
    const session = await provider.openSession({
      connection: connection(),
      tools: [createCommitTool()],
      scope: undefined,
    });

    await expect(
      session.call({
        toolId: 'create_commit',
        arguments: {
          repository: 'shipfox/platform',
          branch: 'feature',
          expected_head_oid: 'a'.repeat(40),
          message: {headline: 'Broken'},
          additions: [{path: 'a.txt', contents: 'x'}],
        },
      }),
    ).rejects.toMatchObject({
      reason: 'malformed-provider-response',
      message: 'GitHub createCommitOnBranch response did not include a commit oid and url',
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

  it.each([
    {
      label: 'create with a submission event',
      callArguments: {method: 'create', event: 'COMMENT', body: 'Summary.'},
      message:
        'Parameter event is not accepted by create, which opens a pending review; submit it with submit_pending',
    },
    {
      label: 'submit_pending without an event',
      callArguments: {method: 'submit_pending', body: 'Summary.'},
      message: 'Parameter event is required for submit_pending',
    },
    {
      label: 'submit_pending with a comment event and no body',
      callArguments: {method: 'submit_pending', event: 'REQUEST_CHANGES'},
      message: 'Parameter body is required for submit_pending unless event is APPROVE',
    },
    {
      label: 'submit_pending with a commit id',
      callArguments: {method: 'submit_pending', event: 'APPROVE', commit_id: 'a'.repeat(40)},
      message: 'Parameter commit_id is not accepted by submit_pending; it applies to create',
    },
    {
      label: 'delete_pending with review fields',
      callArguments: {method: 'delete_pending', body: 'Summary.'},
      message: 'Parameters body, event, and commit_id are not accepted by delete_pending',
    },
  ])('rejects $label before touching GitHub', async ({callArguments, message}) => {
    const request = vi.fn();

    const result = await callGithubToolWithRequest(
      'pull_request_review_write',
      {owner: 'shipfox', repo: 'platform', pull_number: 2, ...callArguments},
      request,
    );

    expect(request).not.toHaveBeenCalled();
    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: message}],
      structuredContent: {code: 'invalid-request'},
    });
  });

  it('lets submit_pending approve without a body', async () => {
    const request = vi.fn(() => Promise.resolve({data: []}));

    const result = await callGithubToolWithRequest(
      'pull_request_review_write',
      {
        method: 'submit_pending',
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 2,
        event: 'APPROVE',
      },
      request,
    );

    expect(request).toHaveBeenCalledOnce();
    expect(result).toMatchObject({isError: true, structuredContent: {code: 'provider-rejected'}});
  });

  it.each([
    {
      label: 'a LINE comment without a line',
      callArguments: {subject_type: 'LINE', side: 'RIGHT'},
      message: 'Parameters line and side are required for a LINE comment',
    },
    {
      label: 'a default-subject comment without a side',
      callArguments: {line: 13},
      message: 'Parameters line and side are required for a LINE comment',
    },
    {
      label: 'a FILE comment with position fields',
      callArguments: {subject_type: 'FILE', line: 13, side: 'RIGHT'},
      message:
        'Parameters line, side, start_line, and start_side are not accepted when subject_type is FILE',
    },
    {
      label: 'a range without start_side',
      callArguments: {subject_type: 'LINE', line: 13, side: 'RIGHT', start_line: 10},
      message: 'Parameters start_line and start_side must be provided together',
    },
    {
      label: 'a range that starts after its end',
      callArguments: {
        subject_type: 'LINE',
        line: 13,
        side: 'RIGHT',
        start_line: 15,
        start_side: 'RIGHT',
      },
      message: 'Parameter start_line must be lower than line for a multi-line comment',
    },
  ])('rejects $label before looking up the pending review', async ({callArguments, message}) => {
    const request = vi.fn();
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
        body: 'Comment.',
        ...callArguments,
      },
    });

    expect(request).not.toHaveBeenCalled();
    expect(graphql).not.toHaveBeenCalled();
    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: message}],
      structuredContent: {code: 'invalid-request'},
    });
  });

  it('reports a null review thread as a provider rejection instead of success', async () => {
    const request = vi.fn().mockResolvedValueOnce({
      data: [{id: 41, node_id: 'review-latest', state: 'PENDING', user: githubAppReviewUser}],
    });
    const graphql = vi.fn().mockResolvedValueOnce({addPullRequestReviewThread: {thread: null}});
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
        body: 'Malformed range.',
        subject_type: 'LINE',
        line: 13,
        side: 'RIGHT',
      },
    });

    expect(graphql).toHaveBeenCalledOnce();
    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'GitHub did not create the review thread. Check that path, line, side, and any start_line range describe a line in the pull request diff.',
        },
      ],
      structuredContent: {code: 'provider-rejected'},
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
        line: 42,
        side: 'RIGHT',
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
          text: 'GitHub installation token is missing permission for this operation: list_issues requires issues: read',
        },
      ],
      structuredContent: {code: 'access-denied'},
    });
  });

  it.each([
    {
      missingPermission: 'contents',
      permissions: {pull_requests: 'write' as const},
    },
    {
      missingPermission: 'pull_requests',
      permissions: {contents: 'write' as const},
    },
  ])('rejects update_pull_request_branch when $missingPermission write is missing', async ({
    permissions,
  }) => {
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {
        getInstallationAccessToken: vi.fn(() =>
          Promise.resolve({
            token: 'installation-token',
            expiresAt: new Date(),
            permissions,
          }),
        ),
      },
    });
    const tool = githubAgentToolCatalog.find((entry) => entry.id === 'update_pull_request_branch');
    if (!tool) throw new Error('Missing update_pull_request_branch tool');
    const session = await provider.openSession({
      connection: connection(),
      tools: [tool],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'update_pull_request_branch',
      arguments: {owner: 'shipfox', repo: 'platform', pull_number: 1},
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'GitHub installation token is missing permission for this operation: update_pull_request_branch requires pull_requests: write, contents: write',
        },
      ],
      structuredContent: {code: 'access-denied'},
    });
  });

  it('authorizes update_pull_request_branch when the installation grants both permissions', async () => {
    const request = vi.fn(() => Promise.resolve({data: {message: 'Branch updated'}}));
    const getInstallationAccessToken = vi.fn(() =>
      Promise.resolve({
        token: 'installation-token',
        expiresAt: new Date(),
        permissions: {
          contents: 'write' as const,
          pull_requests: 'write' as const,
        },
      }),
    );
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {getInstallationAccessToken},
      createClient: vi.fn(() => ({request})),
    });
    const tool = githubAgentToolCatalog.find((entry) => entry.id === 'update_pull_request_branch');
    if (!tool) throw new Error('Missing update_pull_request_branch tool');
    const session = await provider.openSession({
      connection: connection(),
      tools: [tool],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'update_pull_request_branch',
      arguments: {
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 1,
        expected_head_sha: 'head-sha',
      },
    });

    expect(request).toHaveBeenCalledWith(
      'PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch',
      {
        owner: 'shipfox',
        repo: 'platform',
        pull_number: 1,
        expected_head_sha: 'head-sha',
      },
    );
    expect(result).toEqual({
      content: [{type: 'text', text: '{"message":"Branch updated"}'}],
      structuredContent: {message: 'Branch updated'},
    });
    expect(getInstallationAccessToken).toHaveBeenCalledWith(1, undefined, {
      contents: 'write',
      pull_requests: 'write',
    });
  });

  it('creates a branch from a commit oid through the provider session', async () => {
    const request = vi.fn(() =>
      Promise.resolve({
        data: {
          ref: 'refs/heads/shipfox/implement-1',
          url: 'https://api.github.com/repos/shipfox/platform/git/refs/heads/shipfox/implement-1',
          object: {
            sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
            type: 'commit',
            url: 'https://api.github.com/repos/shipfox/platform/git/commits/aa218f56b14c9653891f9e74264a383fa43fefbd',
          },
        },
      }),
    );

    const result = await callGithubToolWithRequest(
      'create_branch',
      {
        repository: 'shipfox/platform',
        branch: 'shipfox/implement-1',
        from: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
      },
      request,
    );

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('POST /repos/{owner}/{repo}/git/refs', {
      owner: 'shipfox',
      repo: 'platform',
      ref: 'refs/heads/shipfox/implement-1',
      sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
    });
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            branch: 'shipfox/implement-1',
            oid: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
            url: 'https://api.github.com/repos/shipfox/platform/git/refs/heads/shipfox/implement-1',
          }),
        },
      ],
      structuredContent: {
        branch: 'shipfox/implement-1',
        oid: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
        url: 'https://api.github.com/repos/shipfox/platform/git/refs/heads/shipfox/implement-1',
      },
    });
  });

  it('resolves a from branch name to its head before creating the branch', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          ref: 'refs/heads/main',
          url: 'https://api.github.com/repos/shipfox/platform/git/refs/heads/main',
          object: {
            sha: 'b1f2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d',
            type: 'commit',
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          ref: 'refs/heads/feature',
          url: 'https://api.github.com/repos/shipfox/platform/git/refs/heads/feature',
          object: {
            sha: 'b1f2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d',
            type: 'commit',
          },
        },
      });

    const result = await callGithubToolWithRequest(
      'create_branch',
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        from: 'main',
      },
      request,
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, 'GET /repos/{owner}/{repo}/git/ref/heads/{branch}', {
      owner: 'shipfox',
      repo: 'platform',
      branch: 'main',
    });
    expect(request).toHaveBeenNthCalledWith(2, 'POST /repos/{owner}/{repo}/git/refs', {
      owner: 'shipfox',
      repo: 'platform',
      ref: 'refs/heads/feature',
      sha: 'b1f2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d',
    });
    expect(result).toEqual({
      content: [{type: 'text', text: expect.stringContaining('"branch":"feature"')}],
      structuredContent: {
        branch: 'feature',
        oid: 'b1f2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d',
        url: 'https://api.github.com/repos/shipfox/platform/git/refs/heads/feature',
      },
    });
  });

  it('reports a provider-rejected error when the branch already exists at a different commit', async () => {
    const providerError = new RequestError('Reference already exists', 422, {
      request: {
        method: 'POST',
        url: 'https://api.github.com/repos/shipfox/platform/git/refs',
        headers: {},
      },
    });
    const request = vi
      .fn()
      .mockRejectedValueOnce(providerError)
      .mockResolvedValueOnce({
        data: {
          ref: 'refs/heads/feature',
          url: 'https://api.github.com/repos/shipfox/platform/git/refs/heads/feature',
          object: {
            sha: 'ffffffffffffffffffffffffffffffffffffffff',
            type: 'commit',
          },
        },
      });

    await expect(
      callGithubToolWithRequest(
        'create_branch',
        {
          repository: 'shipfox/platform',
          branch: 'feature',
          from: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
        },
        request,
      ),
    ).rejects.toMatchObject({
      reason: 'provider-rejected',
      message: "Branch 'feature' already exists in repository shipfox/platform",
      status: 422,
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('reuses an existing branch that already points at the requested commit', async () => {
    const providerError = new RequestError('Reference already exists', 422, {
      request: {
        method: 'POST',
        url: 'https://api.github.com/repos/shipfox/platform/git/refs',
        headers: {},
      },
    });
    const request = vi
      .fn()
      .mockRejectedValueOnce(providerError)
      .mockResolvedValueOnce({
        data: {
          ref: 'refs/heads/feature',
          url: 'https://api.github.com/repos/shipfox/platform/git/refs/heads/feature',
          object: {
            sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
            type: 'commit',
          },
        },
      });

    const result = await callGithubToolWithRequest(
      'create_branch',
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        from: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
      },
      request,
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, 'POST /repos/{owner}/{repo}/git/refs', {
      owner: 'shipfox',
      repo: 'platform',
      ref: 'refs/heads/feature',
      sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
    });
    expect(request).toHaveBeenNthCalledWith(2, 'GET /repos/{owner}/{repo}/git/ref/heads/{branch}', {
      owner: 'shipfox',
      repo: 'platform',
      branch: 'feature',
    });
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            branch: 'feature',
            oid: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
            url: 'https://api.github.com/repos/shipfox/platform/git/refs/heads/feature',
          }),
        },
      ],
      structuredContent: {
        branch: 'feature',
        oid: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
        url: 'https://api.github.com/repos/shipfox/platform/git/refs/heads/feature',
      },
    });
  });

  it('keeps the provider message for a 422 that is not an already-exists error', async () => {
    const providerError = new RequestError('Invalid ref name', 422, {
      request: {
        method: 'POST',
        url: 'https://api.github.com/repos/shipfox/platform/git/refs',
        headers: {},
      },
    });
    const error: unknown = await callGithubToolWithRequest(
      'create_branch',
      {
        repository: 'shipfox/platform',
        branch: 'feature',
        from: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
      },
      vi.fn(() => Promise.reject(providerError)),
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      reason: 'provider-rejected',
      message: 'Invalid ref name',
      status: 422,
    });
    expect(String((error as Error).message).toLowerCase()).not.toContain('already exists');
  });

  it('reports a provider-rejected error when the from branch does not exist', async () => {
    const providerError = new RequestError('Not Found', 404, {
      request: {
        method: 'GET',
        url: 'https://api.github.com/repos/shipfox/platform/git/ref/heads/missing',
        headers: {},
      },
    });

    await expect(
      callGithubToolWithRequest(
        'create_branch',
        {
          repository: 'shipfox/platform',
          branch: 'feature',
          from: 'missing',
        },
        vi.fn(() => Promise.reject(providerError)),
      ),
    ).rejects.toMatchObject({
      reason: 'provider-rejected',
      message:
        "Branch 'missing' does not exist in repository shipfox/platform; from must be a 40-character commit oid or an existing branch name",
      status: 404,
    });
  });

  it('returns an access-denied code when the installation lacks contents write permission', async () => {
    const provider = new GithubAgentToolsProvider({
      getInstallationByConnectionId: vi.fn(() => Promise.resolve(installation())),
      tokenProvider: {
        getInstallationAccessToken: vi.fn(() =>
          Promise.resolve({
            token: 'installation-token',
            expiresAt: new Date(),
            permissions: {pull_requests: 'write' as const},
          }),
        ),
      },
    });
    const tool = githubAgentToolCatalog.find((entry) => entry.id === 'create_branch');
    if (!tool) throw new Error('Missing create_branch tool');
    const session = await provider.openSession({
      connection: connection(),
      tools: [tool],
      scope: undefined,
    });

    const result = await session.call({
      toolId: 'create_branch',
      arguments: {
        repository: 'shipfox/platform',
        branch: 'feature',
        from: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
      },
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'GitHub installation token is missing permission for this operation: create_branch requires contents: write',
        },
      ],
      structuredContent: {code: 'access-denied'},
    });
  });

  it('rejects a repository argument that is not in owner/name form', async () => {
    await expect(
      callGithubTool(
        'create_branch',
        {
          repository: 'platform',
          branch: 'feature',
          from: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
        },
        {},
      ),
    ).rejects.toMatchObject({
      reason: 'ref-invalid',
      message: 'Parameter repository must be a string in owner/name form: platform',
    });
  });

  it('rejects a branch argument that carries a refs/ prefix', async () => {
    await expect(
      callGithubTool(
        'create_branch',
        {
          repository: 'shipfox/platform',
          branch: 'refs/heads/feature',
          from: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
        },
        {},
      ),
    ).rejects.toMatchObject({
      reason: 'ref-invalid',
      message: 'Parameter branch must be a non-empty branch name without a refs/ prefix',
    });
  });

  it('rejects a malformed branch argument before resolving a branch-name from', async () => {
    const request = vi.fn(() => Promise.reject(new Error('must not be called')));

    await expect(
      callGithubToolWithRequest(
        'create_branch',
        {
          repository: 'shipfox/platform',
          branch: 'refs/heads/feature',
          from: 'missing',
        },
        request,
      ),
    ).rejects.toMatchObject({
      reason: 'ref-invalid',
      message: 'Parameter branch must be a non-empty branch name without a refs/ prefix',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects an empty branch argument', async () => {
    await expect(
      callGithubTool(
        'create_branch',
        {
          repository: 'shipfox/platform',
          branch: '',
          from: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
        },
        {},
      ),
    ).rejects.toMatchObject({
      reason: 'ref-invalid',
      message: 'Parameter branch must be a non-empty branch name without a refs/ prefix',
    });
  });

  it('rejects an empty from argument', async () => {
    await expect(
      callGithubTool(
        'create_branch',
        {
          repository: 'shipfox/platform',
          branch: 'feature',
          from: '',
        },
        {},
      ),
    ).rejects.toMatchObject({
      reason: 'ref-invalid',
      message: 'Parameter from must be a 40-character commit oid or a branch name',
    });
  });

  it('rejects a from argument that carries a refs/ prefix', async () => {
    await expect(
      callGithubTool(
        'create_branch',
        {
          repository: 'shipfox/platform',
          branch: 'feature',
          from: 'refs/heads/main',
        },
        {},
      ),
    ).rejects.toMatchObject({
      reason: 'ref-invalid',
      message:
        'Parameter from must be a 40-character commit oid or a branch name without a refs/ prefix',
    });
  });

  it('rejects a repository argument with multiple slashes', async () => {
    await expect(
      callGithubTool(
        'create_branch',
        {
          repository: 'owner/name/extra',
          branch: 'feature',
          from: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
        },
        {},
      ),
    ).rejects.toMatchObject({
      reason: 'ref-invalid',
      message: 'Parameter repository must be a string in owner/name form: owner/name/extra',
    });
  });

  it('rejects a repository argument with a trailing slash', async () => {
    await expect(
      callGithubTool(
        'create_branch',
        {
          repository: 'owner/',
          branch: 'feature',
          from: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
        },
        {},
      ),
    ).rejects.toMatchObject({
      reason: 'ref-invalid',
      message: 'Parameter repository must be a string in owner/name form: owner/',
    });
  });

  it('rejects a non-string repository argument', async () => {
    await expect(
      callGithubTool(
        'create_branch',
        {
          repository: 42,
          branch: 'feature',
          from: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
        },
        {},
      ),
    ).rejects.toMatchObject({
      reason: 'ref-invalid',
      message: 'Parameter repository must be a string in owner/name form',
    });
  });

  it('reports a missing repository parameter as an invalid request', async () => {
    const request = vi.fn();

    const result = await callGithubToolWithRequest(
      'create_branch',
      {
        branch: 'feature',
        from: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
      },
      request,
    );

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'Missing required parameter: repository'}],
      structuredContent: {code: 'invalid-request'},
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('reports a malformed branch head resolution response', async () => {
    const request = vi.fn(() => Promise.resolve({data: {}}));

    await expect(
      callGithubToolWithRequest(
        'create_branch',
        {
          repository: 'shipfox/platform',
          branch: 'feature',
          from: 'main',
        },
        request,
      ),
    ).rejects.toMatchObject({
      reason: 'malformed-provider-response',
      message: 'GitHub branch head resolution response was malformed',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reports a malformed create branch response', async () => {
    const request = vi.fn(() =>
      Promise.resolve({
        data: {
          ref: 'refs/heads/feature',
          url: 'https://api.github.com/repos/shipfox/platform/git/refs/heads/feature',
        },
      }),
    );

    await expect(
      callGithubToolWithRequest(
        'create_branch',
        {
          repository: 'shipfox/platform',
          branch: 'feature',
          from: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
        },
        request,
      ),
    ).rejects.toMatchObject({
      reason: 'malformed-provider-response',
      message: 'GitHub create branch response was malformed',
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
          line: 42,
          side: 'RIGHT',
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
        line: 42,
        side: 'RIGHT',
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
          line: 42,
          side: 'RIGHT',
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
    const submission = method === 'submit_pending' ? {event: 'COMMENT', body: 'Summary.'} : {};

    const result = await callGithubToolWithRequest(
      'pull_request_review_write',
      {method, owner: 'shipfox', repo: 'platform', pull_number: 2, ...submission},
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
      arguments: {owner: 'shipfox', repo: 'platform'},
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
      toolId: 'create_branch',
      arguments: {
        repository: 'shipfox/platform',
        branch: 'feature',
        from: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
      },
      data: {
        ref: 'refs/heads/feature',
        url: 'https://api.github.com/repos/shipfox/platform/git/refs/heads/feature',
        object: {
          sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
          type: 'commit',
          url: 'https://api.github.com/repos/shipfox/platform/git/commits/aa218f56b14c9653891f9e74264a383fa43fefbd',
        },
      },
      expected: {
        branch: 'feature',
        oid: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
        url: 'https://api.github.com/repos/shipfox/platform/git/refs/heads/feature',
      },
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
            checks: 'read' as const,
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

function createCommitTool() {
  const tool = githubAgentToolCatalog.find((entry) => entry.id === 'create_commit');
  if (!tool) throw new Error('Missing create_commit tool');
  return tool;
}

function graphqlError(
  errors: Array<{type?: string; message: string}>,
  response?: {status?: number; headers?: Record<string, string | number | undefined>},
) {
  const error = new Error(errors[0]?.message ?? 'GraphQL error') as Error & {
    errors: Array<{type?: string; message: string}>;
    response?: {status?: number; headers?: Record<string, string | number | undefined>};
  };
  error.name = 'GraphqlResponseError';
  error.errors = errors;
  if (response !== undefined) error.response = response;
  return error;
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
    repositoryAccessMode: 'selected' as const,
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
