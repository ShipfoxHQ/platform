import type {
  AgentToolCatalogEntry,
  AgentToolCatalogMethod,
  AgentToolJsonSchema,
  AgentToolRepositoryScopeClassifier,
  AgentToolRepositoryTarget,
  AgentToolSelectionCatalog,
  AgentToolSelector,
} from '@shipfox/api-integration-spi';

type GithubRepositoryScopeClassifier = AgentToolRepositoryScopeClassifier;

interface GithubCatalogMethod<RequiredScope = unknown>
  extends AgentToolCatalogMethod<RequiredScope> {
  repositoryScope: GithubRepositoryScopeClassifier;
  indirectTargetNote?: string | undefined;
}

interface GithubCatalogEntry<RequiredScope = unknown> extends AgentToolCatalogEntry<RequiredScope> {
  repositoryScope: GithubRepositoryScopeClassifier;
  indirectTargetNote?: string | undefined;
  methods?: readonly GithubCatalogMethod<RequiredScope>[] | undefined;
}

export const DEFAULT_JOB_LOG_TAIL_LINES = 500;

export type GithubAgentToolCategory = 'issues' | 'pull_requests' | 'actions' | 'repository';
export type GithubAgentToolPermission =
  | 'actions'
  | 'checks'
  | 'contents'
  | 'issues'
  | 'pull_requests';
export type GithubAgentToolPermissionAccess = 'read' | 'write';
export type GithubAgentToolSensitivity = 'read' | 'write';

export interface GithubAgentToolRequiredPermission {
  permission: GithubAgentToolPermission;
  access: GithubAgentToolPermissionAccess;
}

export type GithubAgentToolRequiredScope = readonly GithubAgentToolRequiredPermission[];

export type GithubAgentToolCatalogMethod = GithubCatalogMethod<GithubAgentToolRequiredScope>;

export interface GithubAgentToolCatalogEntry
  extends GithubCatalogEntry<GithubAgentToolRequiredScope> {
  category: GithubAgentToolCategory;
  methods?: readonly GithubAgentToolCatalogMethod[] | undefined;
}

interface GithubAgentToolCatalogInput {
  id: string;
  category: GithubAgentToolCategory;
  description: string;
  inputSchema: AgentToolJsonSchema;
  outputSchema: AgentToolJsonSchema;
  sensitivity?: GithubAgentToolSensitivity | undefined;
  sensitive?: boolean | undefined;
  requiredScope?: GithubAgentToolRequiredScope | undefined;
  repositoryScope?: GithubRepositoryScopeClassifier | undefined;
  indirectTargetNote?: string | undefined;
  methods?: readonly GithubAgentToolCatalogMethod[] | undefined;
}

const scopes = {
  issuesRead: [{permission: 'issues', access: 'read'}],
  issuesWrite: [{permission: 'issues', access: 'write'}],
  issueAndPullRequestCommentsWrite: [
    {permission: 'issues', access: 'write'},
    {permission: 'pull_requests', access: 'write'},
  ],
  pullRequestsRead: [{permission: 'pull_requests', access: 'read'}],
  pullRequestsWrite: [{permission: 'pull_requests', access: 'write'}],
  actionsRead: [{permission: 'actions', access: 'read'}],
  actionsWrite: [{permission: 'actions', access: 'write'}],
  checksRead: [{permission: 'checks', access: 'read'}],
  contentsWrite: [{permission: 'contents', access: 'write'}],
  mergePullRequest: [
    {permission: 'pull_requests', access: 'write'},
    {permission: 'contents', access: 'write'},
  ],
} as const satisfies Record<string, GithubAgentToolRequiredScope>;

const repositoryProperties = {
  owner: stringSchema('Repository owner'),
  repo: stringSchema('Repository name'),
};

const indirectSearchTargetNote =
  'The free-form query may match results in repositories other than the declared target.';

const connectionRepositoryScope: GithubRepositoryScopeClassifier = () => ({kind: 'connection'});

const searchRepositoryScope: GithubRepositoryScopeClassifier = (arguments_) => {
  const owner = arguments_.owner;
  const repo = arguments_.repo;
  if (
    typeof owner === 'string' &&
    owner.length > 0 &&
    typeof repo === 'string' &&
    repo.length > 0
  ) {
    return {kind: 'declared-targets', repositories: [{owner, name: repo}]};
  }
  return {
    kind: 'connection',
    requiresExplicitRepository: true,
    indirectTargetNote: indirectSearchTargetNote,
  };
};

/** Classifies explicit repository coordinates without resolving them remotely. */
export const githubRepositoryScope: GithubRepositoryScopeClassifier = (arguments_) => {
  const repositories: AgentToolRepositoryTarget[] = [];
  addRepositoryCoordinate(repositories, arguments_.owner, arguments_.repo);
  addRepositoryCoordinate(repositories, arguments_.base_owner, arguments_.base_repo);
  addRepositoryCoordinate(repositories, arguments_.head_owner, arguments_.head_repo);
  addRepositoryCoordinate(repositories, arguments_.repository_owner, arguments_.repository_name);

  if (typeof arguments_.repository === 'string') {
    const slashIndex = arguments_.repository.indexOf('/');
    if (
      slashIndex > 0 &&
      slashIndex === arguments_.repository.lastIndexOf('/') &&
      slashIndex < arguments_.repository.length - 1
    ) {
      repositories.push({
        owner: arguments_.repository.slice(0, slashIndex),
        name: arguments_.repository.slice(slashIndex + 1),
      });
    }
  }

  return repositories.length === 0
    ? {kind: 'connection'}
    : {kind: 'declared-targets', repositories};
};

function addRepositoryCoordinate(
  repositories: AgentToolRepositoryTarget[],
  owner: unknown,
  name: unknown,
): void {
  if (
    typeof owner === 'string' &&
    owner.length > 0 &&
    typeof name === 'string' &&
    name.length > 0
  ) {
    repositories.push({owner, name});
  }
}

const pageProperties = {
  page: integerSchema('Page number for pagination', {minimum: 1}),
  per_page: integerSchema('Results per page for pagination', {minimum: 1, maximum: 100}),
};

const issueReadMethods = [
  method('get', 'Get information about a specific issue.', 'read', false, scopes.issuesRead),
  method('get_comments', 'Get comments on a specific issue.', 'read', false, scopes.issuesRead),
  method(
    'get_sub_issues',
    'Get sub-issues for a specific issue.',
    'read',
    false,
    scopes.issuesRead,
  ),
  method(
    'get_parent',
    'Get the parent issue for a specific issue.',
    'read',
    false,
    scopes.issuesRead,
  ),
  method(
    'get_labels',
    'Get labels assigned to a specific issue.',
    'read',
    false,
    scopes.issuesRead,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const issueWriteMethods = [
  method('create', 'Create a new issue.', 'write', false, scopes.issuesWrite),
  method('update', 'Update an existing issue.', 'write', false, scopes.issuesWrite),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const subIssueIndirectTargetNote =
  'The opaque child and ordering IDs may refer to another repository in the GitHub installation.';

const subIssueWriteMethods = [
  method(
    'add',
    'Add a sub-issue to a parent issue.',
    'write',
    false,
    scopes.issuesWrite,
    githubRepositoryScope,
    subIssueIndirectTargetNote,
  ),
  method(
    'remove',
    'Remove a sub-issue from a parent issue.',
    'write',
    false,
    scopes.issuesWrite,
    githubRepositoryScope,
    subIssueIndirectTargetNote,
  ),
  method(
    'reprioritize',
    'Reprioritize a sub-issue under its parent issue.',
    'write',
    false,
    scopes.issuesWrite,
    githubRepositoryScope,
    subIssueIndirectTargetNote,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const pullRequestReadMethods = [
  method(
    'get',
    'Get information about a specific pull request.',
    'read',
    false,
    scopes.pullRequestsRead,
  ),
  method(
    'get_diff',
    'Get the diff for a specific pull request.',
    'read',
    false,
    scopes.pullRequestsRead,
  ),
  method(
    'get_status',
    'Get status information for a specific pull request.',
    'read',
    false,
    scopes.pullRequestsRead,
  ),
  method(
    'get_files',
    'Get files changed in a specific pull request.',
    'read',
    false,
    scopes.pullRequestsRead,
  ),
  method(
    'get_commits',
    'Get commits in a specific pull request.',
    'read',
    false,
    scopes.pullRequestsRead,
  ),
  method(
    'get_review_comments',
    'Get review comments for a specific pull request.',
    'read',
    false,
    scopes.pullRequestsRead,
  ),
  method(
    'get_review_threads',
    'Get review threads, their resolution state, and comments for a specific pull request.',
    'read',
    false,
    scopes.pullRequestsRead,
  ),
  method(
    'get_reviews',
    'Get reviews for a specific pull request.',
    'read',
    false,
    scopes.pullRequestsRead,
  ),
  method(
    'get_comments',
    'Get conversation comments for a specific pull request.',
    'read',
    false,
    scopes.issuesRead,
  ),
  method(
    'get_check_runs',
    'Get check runs for the head commit of a pull request.',
    'read',
    false,
    scopes.checksRead,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const pullRequestReviewWriteMethods = [
  method(
    'create',
    'Create a pending pull request review.',
    'write',
    false,
    scopes.pullRequestsWrite,
  ),
  method(
    'submit_pending',
    'Submit the latest pending pull request review.',
    'write',
    false,
    scopes.pullRequestsWrite,
  ),
  method(
    'delete_pending',
    'Delete the latest pending pull request review.',
    'write',
    false,
    scopes.pullRequestsWrite,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const reviewThreadIndirectTargetNote =
  'The review thread node may belong to any repository reachable by the GitHub installation.';

const pullRequestReviewThreadWriteMethods = [
  method(
    'resolve',
    'Resolve a pull request review thread.',
    'write',
    false,
    scopes.pullRequestsWrite,
    connectionRepositoryScope,
    reviewThreadIndirectTargetNote,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const actionsListMethods = [
  method('list_workflows', 'List workflows in a repository.', 'read', false, scopes.actionsRead),
  method(
    'list_workflow_runs',
    'List workflow runs in a repository or for a workflow.',
    'read',
    false,
    scopes.actionsRead,
  ),
  method('list_workflow_jobs', 'List jobs for a workflow run.', 'read', false, scopes.actionsRead),
  method(
    'list_workflow_run_artifacts',
    'List artifacts for a workflow run.',
    'read',
    false,
    scopes.actionsRead,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const actionsGetMethods = [
  method('get_workflow', 'Get details for a workflow.', 'read', false, scopes.actionsRead),
  method('get_workflow_run', 'Get details for a workflow run.', 'read', false, scopes.actionsRead),
  method('get_workflow_job', 'Get details for a workflow job.', 'read', false, scopes.actionsRead),
  method(
    'download_workflow_run_artifact',
    'Download a workflow run artifact.',
    'read',
    false,
    scopes.actionsRead,
  ),
  method('get_workflow_run_usage', 'Get workflow run usage.', 'read', false, scopes.actionsRead),
  method(
    'get_workflow_run_logs_url',
    'Get a workflow run logs download URL.',
    'read',
    false,
    scopes.actionsRead,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

const actionsRunTriggerMethods = [
  method('run_workflow', 'Trigger a workflow_dispatch run.', 'write', true, scopes.actionsWrite),
  method('rerun_workflow_run', 'Rerun a workflow run.', 'write', false, scopes.actionsWrite),
  method(
    'rerun_failed_jobs',
    'Rerun failed jobs in a workflow run.',
    'write',
    false,
    scopes.actionsWrite,
  ),
  method('cancel_workflow_run', 'Cancel a workflow run.', 'write', false, scopes.actionsWrite),
  method(
    'delete_workflow_run_logs',
    'Delete logs for a workflow run.',
    'write',
    true,
    scopes.actionsWrite,
  ),
] as const satisfies readonly GithubAgentToolCatalogMethod[];

export const githubAgentToolCatalog = [
  tool({
    id: 'issue_read',
    category: 'issues',
    description: 'Get information about a specific issue in a GitHub repository.',
    methods: issueReadMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(issueReadMethods, 'The read operation to perform on a single issue'),
        issue_number: integerSchema('The number of the issue'),
        ...pageProperties,
      },
      ['method', 'issue_number'],
    ),
    outputSchema: openObjectSchema('Issue read result'),
  }),
  tool({
    id: 'list_issue_types',
    category: 'issues',
    description:
      'List supported issue types for a repository or its owner organization. When repo is omitted, returns org-level issue types directly.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.issuesRead,
    inputSchema: objectSchema(
      {
        owner: stringSchema('The account owner of the repository or organization'),
        repo: stringSchema('The name of the repository'),
      },
      ['owner'],
    ),
    outputSchema: objectSchema({issue_types: arraySchema(openObjectSchema('Issue type'))}, [
      'issue_types',
    ]),
    repositoryScope: (arguments_) =>
      arguments_.repo === undefined ? {kind: 'connection'} : githubRepositoryScope(arguments_),
  }),
  tool({
    id: 'list_issues',
    category: 'issues',
    description:
      "List issues in a GitHub repository. For pagination, use the 'endCursor' from the previous response's 'pageInfo' in the 'after' parameter.",
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.issuesRead,
    inputSchema: repositoryInputSchema({
      state: enumSchema(['OPEN', 'CLOSED'], 'Filter by state'),
      labels: arraySchema(stringSchema('Label name')),
      orderBy: enumSchema(['CREATED_AT', 'UPDATED_AT', 'COMMENTS'], 'Order issues by field'),
      direction: enumSchema(['ASC', 'DESC'], 'Order direction'),
      since: stringSchema('Filter by date (ISO 8601 timestamp)'),
      after: stringSchema('Pagination cursor'),
      first: integerSchema('Number of issues to return', {minimum: 1, maximum: 100}),
    }),
    outputSchema: objectSchema({issues: arraySchema(openObjectSchema('GitHub issue'))}, ['issues']),
  }),
  tool({
    id: 'search_issues',
    category: 'issues',
    description:
      'Search for issues in GitHub repositories using issues search syntax already scoped to is:issue. Provide owner and repo together for a repository-scoped search; omit both for a connection-scoped search. Do not include unquoted repo:, org:, or user: qualifiers; quoted occurrences are treated as literal text.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.issuesRead,
    repositoryScope: searchRepositoryScope,
    inputSchema: objectSchema(
      {
        query: stringSchema(
          'Search query using GitHub issues search syntax. Do not include unquoted repo:, org:, or user: qualifiers; quoted occurrences are treated as literal text.',
        ),
        owner: stringSchema(
          'Optional repository owner. Provide together with repo, or omit both for a connection-scoped search.',
        ),
        repo: stringSchema(
          'Optional repository name. Provide together with owner, or omit both for a connection-scoped search.',
        ),
        sort: enumSchema(
          [
            'comments',
            'reactions',
            'reactions-+1',
            'reactions--1',
            'reactions-smile',
            'reactions-thinking_face',
            'reactions-heart',
            'reactions-tada',
            'interactions',
            'created',
            'updated',
          ],
          'Sort field',
        ),
        order: enumSchema(['asc', 'desc'], 'Sort order'),
        ...pageProperties,
      },
      ['query'],
      searchRepositoryPairConstraints(),
    ),
    outputSchema: objectSchema({issues: arraySchema(openObjectSchema('GitHub issue'))}, ['issues']),
  }),
  tool({
    id: 'add_issue_comment',
    category: 'issues',
    description:
      'Add a comment and/or reaction to a specific issue or issue comment in a GitHub repository. Use this tool with pull requests as well, but only if the user is not asking specifically to add or react to review comments. At least one of body or reaction is required.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.issueAndPullRequestCommentsWrite,
    inputSchema: repositoryInputSchema(
      {
        issue_number: integerSchema('Issue or pull request number to comment on or react to'),
        comment_id: integerSchema(
          'The numeric ID of the issue or pull request comment to react to',
        ),
        body: stringSchema('Comment content. Required unless reaction is provided'),
        reaction: enumSchema(
          ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'],
          'Emoji reaction to add. Required unless body is provided',
        ),
      },
      [],
      {
        anyOf: [
          {required: ['issue_number', 'body']},
          {required: ['issue_number', 'reaction']},
          {required: ['comment_id', 'reaction']},
        ],
      },
    ),
    outputSchema: openObjectSchema('Created issue comment or reaction'),
  }),
  tool({
    id: 'issue_write',
    category: 'issues',
    description: 'Create a new or update an existing issue in a GitHub repository.',
    methods: issueWriteMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(issueWriteMethods, 'Write operation to perform on a single issue'),
        issue_number: integerSchema('Issue number to update'),
        title: stringSchema('Issue title'),
        body: stringSchema('Issue body content'),
        assignees: arraySchema(stringSchema('GitHub username')),
        labels: arraySchema(stringSchema('Label name')),
        milestone: integerSchema('Milestone number'),
        issue_type: stringSchema('Type of this issue'),
        state: enumSchema(['open', 'closed'], 'New state'),
        state_reason: enumSchema(
          ['completed', 'not_planned', 'duplicate'],
          'Reason for the state change',
        ),
        duplicate_of: integerSchema('Issue number that this issue is a duplicate of'),
      },
      ['method'],
    ),
    outputSchema: openObjectSchema('Issue write result'),
  }),
  tool({
    id: 'sub_issue_write',
    category: 'issues',
    description:
      'Add, remove, or reprioritize a sub-issue under a parent issue in a GitHub repository.',
    methods: subIssueWriteMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(subIssueWriteMethods, 'The action to perform on a single sub-issue'),
        issue_number: integerSchema('The number of the parent issue'),
        sub_issue_id: integerSchema('The ID of the sub-issue'),
        replace_parent: booleanSchema("Replace the sub-issue's current parent issue"),
        after_id: integerSchema('The ID of the sub-issue to be prioritized after'),
        before_id: integerSchema('The ID of the sub-issue to be prioritized before'),
      },
      ['method', 'issue_number', 'sub_issue_id'],
    ),
    outputSchema: openObjectSchema('Sub-issue write result'),
    indirectTargetNote:
      'The opaque child and ordering IDs may refer to another repository in the GitHub installation.',
  }),
  tool({
    id: 'pull_request_read',
    category: 'pull_requests',
    description: 'Get information on a specific pull request in a GitHub repository.',
    methods: pullRequestReadMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(
          pullRequestReadMethods,
          'Action to specify what pull request data needs to be retrieved from GitHub',
        ),
        pull_number: integerSchema('Pull request number'),
        ref: stringSchema('Git reference to inspect. Required for get_status and get_check_runs'),
        cursor: stringSchema('Cursor for review comment pagination'),
        ...pageProperties,
      },
      ['method', 'pull_number'],
      {
        oneOf: [
          methodRequiredSchema('get', []),
          methodRequiredSchema('get_diff', []),
          methodRequiredSchema('get_status', ['ref']),
          methodRequiredSchema('get_files', []),
          methodRequiredSchema('get_commits', []),
          methodRequiredSchema('get_review_comments', []),
          methodRequiredSchema('get_review_threads', []),
          methodRequiredSchema('get_reviews', []),
          methodRequiredSchema('get_comments', []),
          methodRequiredSchema('get_check_runs', ['ref']),
        ],
      },
    ),
    outputSchema: openObjectSchema('Pull request read result'),
  }),
  tool({
    id: 'list_pull_requests',
    category: 'pull_requests',
    description:
      'List pull requests in a GitHub repository. If the user specifies an author, then do not use this tool and use the search_pull_requests tool instead.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.pullRequestsRead,
    inputSchema: repositoryInputSchema({
      state: enumSchema(['open', 'closed', 'all'], 'Filter by state'),
      head: stringSchema('Filter by head user/org and branch'),
      base: stringSchema('Filter by base branch'),
      sort: enumSchema(['created', 'updated', 'popularity', 'long-running'], 'Sort by'),
      direction: enumSchema(['asc', 'desc'], 'Sort direction'),
      ...pageProperties,
    }),
    outputSchema: objectSchema(
      {pull_requests: arraySchema(openObjectSchema('GitHub pull request'))},
      ['pull_requests'],
    ),
  }),
  tool({
    id: 'search_pull_requests',
    category: 'pull_requests',
    description:
      'Search for pull requests in GitHub repositories using issues search syntax already scoped to is:pr. Provide owner and repo together for a repository-scoped search; omit both for a connection-scoped search. Do not include unquoted repo:, org:, or user: qualifiers; quoted occurrences are treated as literal text.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.pullRequestsRead,
    repositoryScope: searchRepositoryScope,
    inputSchema: objectSchema(
      {
        query: stringSchema(
          'Search query using GitHub pull request search syntax. Do not include unquoted repo:, org:, or user: qualifiers; quoted occurrences are treated as literal text.',
        ),
        owner: stringSchema(
          'Optional repository owner. Provide together with repo, or omit both for a connection-scoped search.',
        ),
        repo: stringSchema(
          'Optional repository name. Provide together with owner, or omit both for a connection-scoped search.',
        ),
        sort: enumSchema(
          [
            'comments',
            'reactions',
            'reactions-+1',
            'reactions--1',
            'reactions-smile',
            'reactions-thinking_face',
            'reactions-heart',
            'reactions-tada',
            'interactions',
            'created',
            'updated',
          ],
          'Sort field',
        ),
        order: enumSchema(['asc', 'desc'], 'Sort order'),
        ...pageProperties,
      },
      ['query'],
      searchRepositoryPairConstraints(),
    ),
    outputSchema: objectSchema(
      {pull_requests: arraySchema(openObjectSchema('GitHub pull request'))},
      ['pull_requests'],
    ),
  }),
  tool({
    id: 'create_pull_request',
    category: 'pull_requests',
    description: 'Create a new pull request in a GitHub repository.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.pullRequestsWrite,
    inputSchema: repositoryInputSchema(
      {
        title: stringSchema('PR title'),
        body: stringSchema('PR description'),
        head: stringSchema('Branch containing changes'),
        base: stringSchema('Branch to merge into'),
        draft: booleanSchema('Create as draft PR'),
        maintainer_can_modify: booleanSchema('Allow maintainer edits'),
        reviewers: arraySchema(stringSchema('GitHub username or ORG/team-slug reviewer')),
      },
      ['title', 'head', 'base'],
    ),
    outputSchema: objectSchema({pull_request: openObjectSchema('Created GitHub pull request')}, [
      'pull_request',
    ]),
  }),
  tool({
    id: 'create_commit',
    category: 'repository',
    description:
      'Create a commit on an existing branch in a GitHub repository. The commit is authored and signed by GitHub on behalf of the Shipfox bot (shipfox-ai[bot]) and shows the Verified badge. Renames are expressed as a deletion of the old path plus an addition of the new path. File contents are validated server-side and limited to a total of about 1 MiB per call; keep edits small and explicit. Text contents are sent as utf8 and transcoded to base64 by the server; binary contents can be provided with encoding base64. The expected_head_oid must be the current head of the branch (compare-and-swap): if the branch moved, the commit is rejected with a stale-head error and the call should be retried with the new head. When issuing several dependent commits, derive each expected_head_oid from the returned oid of the previous commit so the commits land in order. Branch protection rules are the only barrier to writing the default branch.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.contentsWrite,
    inputSchema: objectSchema(
      {
        repository: stringSchema(
          'Repository in owner/name format. Must be a repository the connection can access.',
        ),
        branch: stringSchema('The name of the existing branch to commit to'),
        expected_head_oid: stringSchema(
          'The commit oid (40 or 64 hexadecimal characters) the branch head is expected to point to (compare-and-swap)',
        ),
        message: objectSchema(
          {
            headline: stringSchema('Commit headline'),
            body: stringSchema('Commit body'),
          },
          ['headline'],
        ),
        additions: arraySchema(
          objectSchema(
            {
              path: stringSchema('Repository-relative file path'),
              contents: stringSchema('File contents'),
              encoding: enumSchema(['utf8', 'base64'], 'Contents encoding (default utf8)'),
            },
            ['path', 'contents'],
          ),
        ),
        deletions: arraySchema(
          objectSchema({path: stringSchema('Repository-relative file path to delete')}, ['path']),
        ),
      },
      ['repository', 'branch', 'expected_head_oid', 'message'],
    ),
    outputSchema: objectSchema(
      {
        commit: objectSchema(
          {
            oid: stringSchema('The oid of the created commit'),
            url: stringSchema('The URL of the created commit'),
          },
          ['oid', 'url'],
        ),
      },
      ['commit'],
    ),
  }),
  tool({
    id: 'update_pull_request',
    category: 'pull_requests',
    description: 'Update an existing pull request in a GitHub repository.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.pullRequestsWrite,
    inputSchema: repositoryInputSchema(
      {
        pull_number: integerSchema('Pull request number to update'),
        title: stringSchema('New title'),
        body: stringSchema('New description'),
        state: enumSchema(['open', 'closed'], 'New state'),
        base: stringSchema('New base branch name'),
        maintainer_can_modify: booleanSchema('Allow maintainer edits'),
        reviewers: arraySchema(stringSchema('GitHub username or ORG/team-slug reviewer')),
      },
      ['pull_number'],
    ),
    outputSchema: objectSchema({pull_request: openObjectSchema('Updated GitHub pull request')}, [
      'pull_request',
    ]),
  }),
  tool({
    id: 'add_reply_to_pull_request_comment',
    category: 'pull_requests',
    description:
      'Add a reply and/or reaction to an existing pull request comment. This can create a new comment linked as a reply to the specified comment, add an emoji reaction to the specified comment, or do both. At least one of body or reaction is required.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.pullRequestsWrite,
    inputSchema: repositoryInputSchema(
      {
        pull_number: integerSchema('Pull request number. Required when body is provided'),
        comment_id: integerSchema(
          'The numeric ID of the pull request review comment to reply or react to',
        ),
        body: stringSchema('The text of the reply'),
        reaction: enumSchema(
          ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'],
          'Emoji reaction to add',
        ),
      },
      ['comment_id'],
      {anyOf: [{required: ['pull_number', 'body']}, {required: ['reaction']}]},
    ),
    outputSchema: openObjectSchema('Pull request comment reply or reaction result'),
  }),
  tool({
    id: 'merge_pull_request',
    category: 'pull_requests',
    description: 'Merge a pull request in a GitHub repository.',
    sensitivity: 'write',
    sensitive: true,
    requiredScope: scopes.mergePullRequest,
    inputSchema: repositoryInputSchema(
      {
        pull_number: integerSchema('Pull request number'),
        commit_title: stringSchema('Title for merge commit'),
        commit_message: stringSchema('Extra detail for merge commit'),
        merge_method: enumSchema(['merge', 'squash', 'rebase'], 'Merge method'),
      },
      ['pull_number'],
    ),
    outputSchema: objectSchema({merge: openObjectSchema('Merge result')}, ['merge']),
  }),
  tool({
    id: 'update_pull_request_branch',
    category: 'pull_requests',
    description:
      'Update the branch of a pull request with the latest changes from the base branch.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.mergePullRequest,
    inputSchema: repositoryInputSchema(
      {
        pull_number: integerSchema('Pull request number'),
        expected_head_sha: stringSchema("The expected SHA of the pull request's HEAD ref"),
      },
      ['pull_number'],
    ),
    outputSchema: openObjectSchema('Pull request branch update result'),
    indirectTargetNote:
      'GitHub can also update the pull request head branch, which may belong to another repository.',
  }),
  tool({
    id: 'pull_request_review_write',
    category: 'pull_requests',
    description: 'Create and/or submit, delete review of a pull request.',
    methods: pullRequestReviewWriteMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(
          pullRequestReviewWriteMethods,
          'The write operation to perform on pull request review',
        ),
        pull_number: integerSchema('Pull request number'),
        body: stringSchema('Review comment text'),
        event: enumSchema(['APPROVE', 'REQUEST_CHANGES', 'COMMENT'], 'Review action to perform'),
        commit_id: stringSchema('SHA of commit to review'),
      },
      ['method', 'pull_number'],
    ),
    outputSchema: openObjectSchema('Pull request review write result'),
  }),
  tool({
    id: 'pull_request_review_thread_write',
    category: 'pull_requests',
    description:
      'Resolve a pull request review thread by opaque node ID. This operation is connection-scoped because the node ID does not declare a repository.',
    methods: pullRequestReviewThreadWriteMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(
          pullRequestReviewThreadWriteMethods,
          'The write operation to perform on a pull request review thread',
        ),
        thread_id: stringSchema('The node ID of the review thread'),
      },
      ['method', 'thread_id'],
    ),
    outputSchema: openObjectSchema('Pull request review thread write result'),
    repositoryScope: connectionRepositoryScope,
    indirectTargetNote:
      'The review thread node may belong to any repository reachable by the GitHub installation.',
  }),
  tool({
    id: 'add_comment_to_pending_review',
    category: 'pull_requests',
    description:
      "Add a review comment to the requester's latest pending pull request review. The comment remains part of that pending review until it is submitted; a pending review needs to already exist to call this.",
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.pullRequestsWrite,
    inputSchema: repositoryInputSchema(
      {
        pull_number: integerSchema('Pull request number'),
        path: stringSchema('The relative path to the file that necessitates a comment'),
        body: stringSchema('The text of the review comment'),
        subject_type: enumSchema(['LINE', 'FILE'], 'The level at which the comment is targeted'),
        line: integerSchema('The line of the blob in the pull request diff'),
        side: enumSchema(['LEFT', 'RIGHT'], 'The side of the diff to comment on'),
        start_line: integerSchema('The first line of a multi-line comment range'),
        start_side: enumSchema(
          ['LEFT', 'RIGHT'],
          'The starting side of a multi-line comment range',
        ),
      },
      ['pull_number', 'path', 'body'],
    ),
    outputSchema: openObjectSchema('Pending review comment result'),
  }),
  tool({
    id: 'actions_list',
    category: 'actions',
    description:
      'Tools for listing GitHub Actions resources. Use this tool to list workflows in a repository, or list workflow runs, jobs, and artifacts for a specific workflow or workflow run.',
    methods: actionsListMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(actionsListMethods, 'The action to perform'),
        resource_id: stringSchema('The unique identifier of the resource'),
        workflow_runs_filter: openObjectSchema('Filters for workflow runs'),
        workflow_jobs_filter: openObjectSchema('Filters for workflow jobs'),
        ...pageProperties,
      },
      ['method'],
    ),
    outputSchema: openObjectSchema('Actions list result'),
  }),
  tool({
    id: 'actions_get',
    category: 'actions',
    description:
      'Get details about specific GitHub Actions resources. Use this tool to get details about individual workflows, workflow runs, jobs, and artifacts by their unique IDs.',
    methods: actionsGetMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(actionsGetMethods, 'The method to execute'),
        resource_id: stringSchema('The unique identifier of the resource'),
      },
      ['method', 'resource_id'],
    ),
    outputSchema: openObjectSchema('Actions get result'),
  }),
  tool({
    id: 'actions_run_trigger',
    category: 'actions',
    description:
      'Trigger GitHub Actions workflow operations, including running, re-running, cancelling workflow runs, and deleting workflow run logs.',
    methods: actionsRunTriggerMethods,
    inputSchema: repositoryInputSchema(
      {
        method: methodSchema(actionsRunTriggerMethods, 'The method to execute'),
        workflow_id: stringSchema(
          'The workflow ID or workflow file name. Required for run_workflow',
        ),
        ref: stringSchema('The git reference for the workflow. Required for run_workflow'),
        inputs: openObjectSchema('Inputs the workflow accepts. Only used for run_workflow'),
        run_id: integerSchema(
          'The ID of the workflow run. Required for all methods except run_workflow',
        ),
      },
      ['method'],
      {
        oneOf: [
          methodRequiredSchema('run_workflow', ['workflow_id', 'ref']),
          methodRequiredSchema('rerun_workflow_run', ['run_id']),
          methodRequiredSchema('rerun_failed_jobs', ['run_id']),
          methodRequiredSchema('cancel_workflow_run', ['run_id']),
          methodRequiredSchema('delete_workflow_run_logs', ['run_id']),
        ],
      },
    ),
    outputSchema: openObjectSchema('Actions run trigger result'),
  }),
  tool({
    id: 'get_job_logs',
    category: 'actions',
    description:
      'Get logs for GitHub Actions workflow jobs. Use this tool to retrieve logs for a specific job or all failed jobs in a workflow run. For single job logs, provide job_id. For all failed jobs in a run, provide run_id with failed_only=true.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: scopes.actionsRead,
    inputSchema: repositoryInputSchema({
      job_id: numberSchema(
        'The unique identifier of the workflow job. Required when getting logs for a single job.',
      ),
      run_id: numberSchema(
        'The unique identifier of the workflow run. Required when failed_only is true to get logs for all failed jobs in the run.',
      ),
      failed_only: booleanSchema(
        'When true, gets logs for all failed jobs in the workflow run specified by run_id. Requires run_id to be provided.',
      ),
      return_content: booleanSchema('Returns actual log content instead of URLs'),
      tail_lines: {
        ...numberSchema('Number of lines to return from the end of the log'),
        default: DEFAULT_JOB_LOG_TAIL_LINES,
      },
    }),
    outputSchema: openObjectSchema('GitHub Actions workflow job logs'),
  }),
  tool({
    id: 'create_branch',
    category: 'repository',
    description:
      'Create a branch in a GitHub repository pointing at a commit. Provide `from` as a 40-character commit oid (for example, the checkout commit of a step) or as an existing branch name, which the server resolves to its current head at call time. An existing branch is reused when it already points at the requested commit, and rejected otherwise. Creating a branch fires GitHub push-event workflows from the new ref, so only branch from commits you intend to activate.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: scopes.contentsWrite,
    inputSchema: objectSchema(
      {
        repository: stringSchema('The repository in owner/name form'),
        branch: stringSchema('The name of the branch to create, without any refs/ prefix'),
        from: stringSchema(
          'The 40-character commit oid or existing branch name the new branch points at',
        ),
      },
      ['repository', 'branch', 'from'],
    ),
    outputSchema: objectSchema(
      {
        branch: stringSchema('The name of the created branch'),
        oid: stringSchema('The commit oid the created branch points at'),
        url: stringSchema('The API URL of the created git ref'),
      },
      ['branch', 'oid', 'url'],
    ),
  }),
] as const satisfies readonly GithubAgentToolCatalogEntry[];

export type GithubAgentToolId = (typeof githubAgentToolCatalog)[number]['id'];

export function buildGithubAgentToolSelectionCatalog(
  catalog: readonly GithubAgentToolCatalogEntry[],
): AgentToolSelectionCatalog {
  return {
    selectors: catalog.flatMap((entry): AgentToolSelector[] => {
      if (!entry.methods) {
        return [
          {
            token: entry.id,
            kind: 'standalone',
            sensitivity: entry.sensitivity,
            sensitive: entry.sensitive,
          },
        ];
      }

      return [
        {
          token: entry.id,
          kind: 'family',
          sensitivity: entry.sensitivity,
          sensitive: entry.sensitive,
        },
        {
          token: `${entry.id}.*`,
          kind: 'family_wildcard',
          sensitivity: entry.sensitivity,
          sensitive: entry.sensitive,
        },
        ...entry.methods.map((method) => ({
          token: `${entry.id}.${method.id}`,
          kind: 'method' as const,
          sensitivity: method.sensitivity,
          sensitive: method.sensitive,
        })),
      ];
    }),
  };
}

export const githubAgentToolSelectionCatalog =
  buildGithubAgentToolSelectionCatalog(githubAgentToolCatalog);

function tool(input: GithubAgentToolCatalogInput): GithubAgentToolCatalogEntry {
  if (!input.methods) {
    if (!input.sensitivity || input.sensitive === undefined || !input.requiredScope) {
      throw new Error(`GitHub agent tool ${input.id} is missing sensitivity or required scope`);
    }
    return {
      id: input.id,
      category: input.category,
      description: input.description,
      sensitivity: input.sensitivity,
      sensitive: input.sensitive,
      requiredScope: input.requiredScope,
      inputSchema: input.inputSchema,
      outputSchema: input.outputSchema,
      repositoryScope: input.repositoryScope ?? githubRepositoryScope,
      ...(input.indirectTargetNote === undefined
        ? {}
        : {indirectTargetNote: input.indirectTargetNote}),
    };
  }

  return {
    id: input.id,
    category: input.category,
    description: input.description,
    sensitivity: input.methods.some((candidate) => candidate.sensitivity === 'write')
      ? 'write'
      : 'read',
    sensitive: input.methods.some((candidate) => candidate.sensitive),
    requiredScope: unionRequiredScopes(input.methods),
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    repositoryScope: input.repositoryScope ?? githubRepositoryScope,
    ...(input.indirectTargetNote === undefined
      ? {}
      : {indirectTargetNote: input.indirectTargetNote}),
    methods: input.methods,
  };
}

function method(
  id: string,
  description: string,
  sensitivity: GithubAgentToolSensitivity,
  sensitive: boolean,
  requiredScope: GithubAgentToolRequiredScope,
  repositoryScope: GithubRepositoryScopeClassifier = githubRepositoryScope,
  indirectTargetNote?: string,
): GithubAgentToolCatalogMethod {
  return {
    id,
    description,
    sensitivity,
    sensitive,
    requiredScope,
    repositoryScope,
    ...(indirectTargetNote === undefined ? {} : {indirectTargetNote}),
  };
}

function unionRequiredScopes(
  methods: readonly GithubAgentToolCatalogMethod[],
): GithubAgentToolRequiredScope {
  const byPermission = new Map<GithubAgentToolPermission, GithubAgentToolPermissionAccess>();

  for (const {requiredScope} of methods) {
    for (const {permission, access} of requiredScope) {
      if (byPermission.get(permission) === 'write') continue;
      byPermission.set(permission, access);
    }
  }

  return [...byPermission.entries()].map(([permission, access]) => ({permission, access}));
}

function repositoryInputSchema(
  properties: Record<string, AgentToolJsonSchema> = {},
  required: string[] = [],
  extraSchema: Partial<AgentToolJsonSchema> = {},
): AgentToolJsonSchema {
  return objectSchema(
    {...repositoryProperties, ...properties},
    ['owner', 'repo', ...required],
    extraSchema,
  );
}

function objectSchema(
  properties: Record<string, AgentToolJsonSchema>,
  required: string[] = [],
  extraSchema: Partial<AgentToolJsonSchema> = {},
): AgentToolJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? {required} : {}),
    ...extraSchema,
  };
}

function searchRepositoryPairConstraints(): Pick<AgentToolJsonSchema, 'oneOf'> {
  return {
    oneOf: [
      {properties: repositoryProperties, required: ['owner', 'repo']},
      {
        not: {
          anyOf: [
            {properties: repositoryProperties, required: ['owner']},
            {properties: repositoryProperties, required: ['repo']},
          ],
        },
      },
    ],
  };
}

function methodRequiredSchema(methodId: string, required: string[]): AgentToolJsonSchema {
  return {
    properties: {
      method: {const: methodId},
    },
    required,
  };
}

function openObjectSchema(description: string): AgentToolJsonSchema {
  return {type: 'object', description, additionalProperties: true};
}

function stringSchema(description?: string): AgentToolJsonSchema {
  return {type: 'string', ...(description ? {description} : {})};
}

function integerSchema(
  description?: string,
  options: {minimum?: number | undefined; maximum?: number | undefined} = {},
): AgentToolJsonSchema {
  return {type: 'integer', ...(description ? {description} : {}), ...options};
}

function numberSchema(description?: string): AgentToolJsonSchema {
  return {type: 'number', ...(description ? {description} : {})};
}

function booleanSchema(description: string): AgentToolJsonSchema {
  return {type: 'boolean', description};
}

function enumSchema(values: string[], description: string): AgentToolJsonSchema {
  return {type: 'string', description, enum: values};
}

function methodSchema(
  methods: readonly GithubAgentToolCatalogMethod[],
  description: string,
): AgentToolJsonSchema {
  return enumSchema(
    methods.map((candidate) => candidate.id),
    description,
  );
}

function arraySchema(items: AgentToolJsonSchema): AgentToolJsonSchema {
  return {type: 'array', items};
}
