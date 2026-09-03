import type {
  AgentToolCallInput,
  AgentToolCatalogEntry,
  AgentToolSelectionCatalog,
  AgentToolSession,
  AgentToolsProvider,
  IntegrationConnection,
  IntegrationProviderErrorReason,
  OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';
import {MAX_REPOSITORY_FILE_BYTES} from '@shipfox/api-integration-spi';
import {Octokit} from 'octokit';
import {mapGithubError} from '#api/client.js';
import type {GithubInstallationTokenPermissions} from '#api/installation-token-envelope.js';
import {
  createGithubInstallationTokenProvider,
  type GithubInstallationTokenProvider,
} from '#api/installation-token-provider.js';
import {normalizedGithubApiBaseUrl} from '#config.js';
import type {GithubInstallation} from '#db/installations.js';
import {githubAppBotLogin} from './bot-identity.js';
import {GithubIntegrationProviderError} from './errors.js';
import {
  type GithubAgentToolCatalogEntry,
  type GithubAgentToolId,
  type GithubAgentToolRequiredScope,
  githubAgentToolCatalog,
  githubAgentToolSelectionCatalog,
} from './github-agent-tool-catalog.js';

export type {
  AgentToolRepositoryScope,
  AgentToolRepositoryScopeClassifier,
  AgentToolRepositoryTarget,
} from '@shipfox/api-integration-spi';
export type {
  GithubAgentToolCatalogEntry,
  GithubAgentToolCategory,
  GithubAgentToolId,
  GithubAgentToolPermission,
  GithubAgentToolPermissionAccess,
  GithubAgentToolRequiredPermission,
  GithubAgentToolRequiredScope,
  GithubAgentToolSensitivity,
} from './github-agent-tool-catalog.js';
export {
  buildGithubAgentToolSelectionCatalog,
  DEFAULT_JOB_LOG_TAIL_LINES,
  githubAgentToolCatalog,
  githubAgentToolSelectionCatalog,
  githubRepositoryScope,
} from './github-agent-tool-catalog.js';

type GithubIntegrationConnection = IntegrationConnection<'github'>;

type GithubToolCallResult = {
  isError?: boolean | undefined;
  content: readonly {type: 'text'; text: string}[];
  structuredContent?: Record<string, unknown> | undefined;
};

type GithubToolErrorCode = 'invalid-request' | IntegrationProviderErrorReason;

const GITHUB_GRAPHQL_ROUTE = 'POST /graphql';
const GITHUB_ARTIFACT_ARCHIVE_FORMAT = 'zip';
const GITHUB_ARTIFACT_DOWNLOAD_ROUTE = `GET /repos/{owner}/{repo}/actions/artifacts/{resource_id}/${GITHUB_ARTIFACT_ARCHIVE_FORMAT}`;
const GITHUB_ARTIFACT_DOWNLOAD_TIMEOUT_MS = 30_000;
const PENDING_REVIEW_PAGE_SIZE = 100;
const PENDING_REVIEW_MAX_PAGE_REQUESTS = 5;
const PENDING_REVIEW_LOOKUP_TIMEOUT_MS = 15_000;
const PENDING_REVIEW_PAGE_TIMEOUT_MS = 5_000;
const PENDING_REVIEW_PAGE_PATTERN = /[?&]page=(\d+)/u;
const NO_PENDING_REVIEW_MESSAGE =
  'No pending pull request review found for the authenticated GitHub user.';

const ADD_PENDING_REVIEW_COMMENT_MUTATION = `
  mutation AddCommentToPendingReview($input: AddPullRequestReviewThreadInput!) {
    addPullRequestReviewThread(input: $input) {
      thread {
        id
      }
    }
  }
`;

const GET_PULL_REQUEST_REVIEW_THREADS_QUERY = `
  query GetPullRequestReviewThreads(
    $owner: String!
    $repo: String!
    $pullNumber: Int!
    $after: String
  ) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pullNumber) {
        reviewThreads(first: 100, after: $after) {
          nodes {
            id
            isResolved
            comments(first: 100) {
              nodes {
                id
                databaseId
                body
                author {
                  login
                }
                path
                line
                side
                startLine
                startSide
                createdAt
                updatedAt
                url
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const RESOLVE_PULL_REQUEST_REVIEW_THREAD_MUTATION = `
  mutation ResolvePullRequestReviewThread($input: ResolveReviewThreadInput!) {
    resolveReviewThread(input: $input) {
      thread {
        id
        isResolved
      }
    }
  }
`;

export const CREATE_COMMIT_ON_BRANCH_MUTATION = `
  mutation CreateCommitOnBranch($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      commit {
        oid
        url
      }
    }
  }
`;

export class GithubAgentToolsProvider
  implements
    AgentToolsProvider<
      GithubIntegrationConnection,
      GithubAgentToolRequiredScope,
      GithubAgentToolsScope | undefined,
      GithubToolCallResult
    >
{
  private readonly tokenProvider: GithubInstallationTokenProvider;

  constructor(private readonly options: GithubAgentToolsProviderOptions = {}) {
    this.tokenProvider = options.tokenProvider ?? createGithubInstallationTokenProvider();
  }

  catalog(): readonly GithubAgentToolCatalogEntry[] {
    return githubAgentToolCatalog;
  }

  selectionCatalog(): AgentToolSelectionCatalog {
    return githubAgentToolSelectionCatalog;
  }

  async openSession(
    input: OpenAgentToolsSessionInput<
      GithubIntegrationConnection,
      GithubAgentToolRequiredScope,
      GithubAgentToolsScope | undefined
    >,
  ): Promise<AgentToolSession<GithubToolCallResult>> {
    const installation = await this.options.getInstallationByConnectionId?.(input.connection.id);
    if (!installation) {
      throw new GithubIntegrationProviderError(
        'installation-not-found',
        'GitHub installation is not connected to this integration',
      );
    }
    const installationId = Number(installation.installationId);
    if (!Number.isSafeInteger(installationId) || installationId < 1) {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub installation has an invalid installation ID',
      );
    }
    const liveCatalog = this.catalog();
    const authorizedTools = intersectGithubToolsWithLiveCatalog(input.tools, liveCatalog);
    // The core tool-call service opens one-tool sessions, while scope retains
    // the full frozen integration selection. Aggregate the token profile from
    // that selection so sequential calls reuse one token profile.
    const selectedTools = input.scope?.tools ?? input.tools;
    const profileTools = intersectGithubToolsWithLiveCatalog(selectedTools, liveCatalog);
    const permissionProfile = githubToolPermissionProfile(profileTools);
    let tokenPromise:
      | ReturnType<GithubInstallationTokenProvider['getInstallationAccessToken']>
      | undefined;

    return {
      call: async (call) => {
        const tool = authorizedTools.find((candidate) => candidate.id === call.toolId);
        if (!tool) return githubToolError(`Unknown GitHub tool: ${call.toolId}`, 'invalid-request');
        const operation = resolveGithubOperation(tool, call);
        if (operation === undefined)
          return githubToolError('Unknown GitHub tool operation', 'invalid-request');
        const validationError = validateGithubToolArguments(tool, call.arguments);
        if (validationError) {
          return typeof validationError === 'string'
            ? githubToolError(validationError, 'invalid-request')
            : githubToolError(validationError.message, validationError.code);
        }
        tokenPromise ??= this.tokenProvider.getInstallationAccessToken(
          installationId,
          undefined,
          permissionProfile.permissions,
        );
        const token = await tokenPromise;
        if (!hasGrantedPermissions(token.permissions ?? {}, tool, call)) {
          return githubToolError(githubPermissionDeniedMessage(tool, call), 'access-denied');
        }
        const client = (this.options.createClient ?? createOctokitClient)(token.token);
        const method =
          typeof call.arguments.method === 'string' ? call.arguments.method : undefined;
        return await executeGithubToolOperation(client, tool, operation, method);
      },
    };
  }
}

async function executeGithubToolOperation(
  client: GithubToolClient,
  tool: AgentToolCatalogEntry<GithubAgentToolRequiredScope>,
  operation: GithubToolOperation,
  method: string | undefined,
): Promise<GithubToolCallResult> {
  const toolId = tool.id as GithubAgentToolId;
  if (operation.kind === 'graphql') {
    const data = await mapGithubError(() =>
      executeGithubGraphqlOperation(client, toolId, method, operation.parameters),
    );
    if (data === undefined && tool.id === 'add_comment_to_pending_review') {
      return githubToolError(NO_PENDING_REVIEW_MESSAGE, 'provider-rejected');
    }
    return githubToolResult(toolId, data);
  }
  const parameters = await mapGithubError(() =>
    resolveGithubOperationParameters(client, operation.parameters, toolId, method),
  );
  if (parameters === undefined) {
    return githubToolError(NO_PENDING_REVIEW_MESSAGE, 'provider-rejected');
  }
  const response = await mapGithubError(() =>
    executeGithubRestOperation(client, operation.route, parameters, toolId),
  );
  return githubToolResult(toolId, response.data, response, parameters, operation.route);
}

export interface GithubAgentToolsProviderOptions {
  getInstallationByConnectionId?:
    | ((connectionId: string) => Promise<GithubInstallation | undefined>)
    | undefined;
  tokenProvider?: GithubInstallationTokenProvider | undefined;
  createClient?: GithubToolClientFactory | undefined;
}

interface GithubToolPermissionProfile {
  permissions: GithubInstallationTokenPermissions;
}

interface GithubToolSelection {
  id: string;
  methods?: readonly GithubToolSelectionMethod[] | undefined;
}

interface GithubToolSelectionMethod {
  id: string;
}

interface GithubAgentToolsScope {
  tools?: readonly GithubToolSelection[] | undefined;
}

function intersectGithubToolsWithLiveCatalog(
  tools: readonly GithubToolSelection[],
  liveCatalog: readonly GithubAgentToolCatalogEntry[],
): AgentToolCatalogEntry<GithubAgentToolRequiredScope>[] {
  return tools.flatMap((tool) => {
    const authorizedTool = intersectGithubToolWithLiveCatalog(tool, liveCatalog);
    return authorizedTool === undefined ? [] : [authorizedTool];
  });
}

function intersectGithubToolWithLiveCatalog(
  tool: GithubToolSelection,
  liveCatalog: readonly GithubAgentToolCatalogEntry[],
): AgentToolCatalogEntry<GithubAgentToolRequiredScope> | undefined {
  const liveTool = liveCatalog.find((candidate) => candidate.id === tool.id);
  if (liveTool === undefined) return undefined;
  if (tool.methods === undefined) return liveTool;
  if (liveTool.methods === undefined) return undefined;

  const allowedMethods = new Set(tool.methods.map((method) => method.id));
  const methods = liveTool.methods.filter((method) => allowedMethods.has(method.id));
  return methods.length === 0 ? undefined : {...liveTool, methods};
}

function githubToolPermissionProfile(
  authorizedTools: readonly AgentToolCatalogEntry<GithubAgentToolRequiredScope>[],
): GithubToolPermissionProfile {
  const permissionsByName = new Map<string, 'read' | 'write'>();

  for (const tool of authorizedTools) {
    if (tool.methods === undefined) {
      addGithubRequiredScope(permissionsByName, tool.requiredScope);
      continue;
    }
    for (const method of tool.methods) {
      addGithubRequiredScope(permissionsByName, method.requiredScope);
    }
  }

  const permissions = Object.fromEntries(
    [...permissionsByName.entries()].sort(([first], [second]) => {
      if (first < second) return -1;
      if (first > second) return 1;
      return 0;
    }),
  ) as GithubInstallationTokenPermissions;
  return {
    permissions,
  };
}

function addGithubRequiredScope(
  permissions: Map<string, 'read' | 'write'>,
  requiredScope: GithubAgentToolRequiredScope,
): void {
  for (const {permission, access} of requiredScope) {
    if (permissions.get(permission) === 'write') continue;
    permissions.set(permission, access);
  }
}

export interface GithubToolResponse {
  data: unknown;
  headers?: Record<string, string | number | undefined> | undefined;
  status?: number | undefined;
  url?: string | undefined;
}

export interface GithubToolClient {
  request(route: string, parameters: Record<string, unknown>): Promise<GithubToolResponse>;
  graphql?: ((query: string, variables: Record<string, unknown>) => Promise<unknown>) | undefined;
}

export type GithubToolClientFactory = (token: string) => GithubToolClient;

interface GithubToolOperation {
  route: string;
  parameters: Record<string, unknown>;
  kind: 'rest' | 'graphql';
}

function createOctokitClient(token: string): GithubToolClient {
  const octokit = new Octokit({
    auth: token,
    baseUrl: normalizedGithubApiBaseUrl(),
    retry: {enabled: false},
  });
  return {
    request: async (route, parameters) => {
      if (route !== GITHUB_ARTIFACT_DOWNLOAD_ROUTE) {
        return await octokit.request(route, parameters);
      }

      const abortController = new AbortController();
      const timeout = setTimeout(
        () => abortController.abort(),
        GITHUB_ARTIFACT_DOWNLOAD_TIMEOUT_MS,
      );
      try {
        return await octokit.request(route, {
          ...parameters,
          request: {
            redirect: 'manual',
            parseSuccessResponseBody: false,
            signal: abortController.signal,
          },
        });
      } finally {
        clearTimeout(timeout);
      }
    },
    graphql: async (query, variables) => await octokit.graphql(query, variables),
  };
}

function resolveGithubOperation(
  tool: AgentToolCatalogEntry<GithubAgentToolRequiredScope>,
  call: AgentToolCallInput,
): GithubToolOperation | undefined {
  const args = call.arguments;
  const method = typeof args.method === 'string' ? args.method : undefined;
  const params = {...args};
  delete params.method;

  if (tool.methods && !tool.methods.some((candidate) => candidate.id === method)) return undefined;

  const toolId = tool.id as GithubAgentToolId;
  const route = githubOperationRoute(toolId, method, params);
  return route === undefined
    ? undefined
    : {
        route,
        parameters: projectGithubOperationParameters(toolId, method, params),
        kind: route === GITHUB_GRAPHQL_ROUTE ? 'graphql' : 'rest',
      };
}

export function githubOperationRoute(
  toolId: GithubAgentToolId,
  method: string | undefined,
  args: Record<string, unknown>,
): string | undefined {
  const owner = '{owner}';
  const repo = '{repo}';
  const issue = '{issue_number}';
  const pull = '{pull_number}';
  const run = '{run_id}';
  const resource = '{resource_id}';
  const repoPath = `/repos/${owner}/${repo}`;

  switch (`${toolId}.${method ?? ''}`) {
    case 'issue_read.get':
      return `GET ${repoPath}/issues/${issue}`;
    case 'issue_read.get_comments':
      return `GET ${repoPath}/issues/${issue}/comments`;
    case 'issue_read.get_sub_issues':
      return `GET ${repoPath}/issues/${issue}/sub_issues`;
    case 'issue_read.get_parent':
      return `GET ${repoPath}/issues/${issue}/parent`;
    case 'issue_read.get_labels':
      return `GET ${repoPath}/issues/${issue}/labels`;
    case 'list_issue_types.':
      return args.repo === undefined
        ? 'GET /orgs/{owner}/issue-types'
        : `GET ${repoPath}/issue-types`;
    case 'list_issues.':
      return `GET ${repoPath}/issues`;
    case 'search_issues.':
      return 'GET /search/issues';
    case 'add_issue_comment.':
      if (args.comment_id !== undefined)
        return `POST ${repoPath}/issues/comments/{comment_id}/reactions`;
      return args.reaction !== undefined && args.body === undefined
        ? `POST ${repoPath}/issues/${issue}/reactions`
        : `POST ${repoPath}/issues/${issue}/comments`;
    case 'issue_write.create':
      return `POST ${repoPath}/issues`;
    case 'issue_write.update':
      return `PATCH ${repoPath}/issues/${issue}`;
    case 'sub_issue_write.add':
      return `POST ${repoPath}/issues/${issue}/sub_issues`;
    case 'sub_issue_write.remove':
      return `DELETE ${repoPath}/issues/${issue}/sub_issues/{sub_issue_id}`;
    case 'sub_issue_write.reprioritize':
      return `PATCH ${repoPath}/issues/${issue}/sub_issues/priority`;
    case 'pull_request_read.get':
      return `GET ${repoPath}/pulls/${pull}`;
    case 'pull_request_read.get_diff':
      return `GET ${repoPath}/pulls/${pull}`;
    case 'pull_request_read.get_status':
      return `GET ${repoPath}/commits/{ref}/status`;
    case 'pull_request_read.get_files':
      return `GET ${repoPath}/pulls/${pull}/files`;
    case 'pull_request_read.get_commits':
      return `GET ${repoPath}/pulls/${pull}/commits`;
    case 'pull_request_read.get_review_comments':
      return `GET ${repoPath}/pulls/${pull}/comments`;
    case 'pull_request_read.get_review_threads':
      return GITHUB_GRAPHQL_ROUTE;
    case 'pull_request_read.get_reviews':
      return `GET ${repoPath}/pulls/${pull}/reviews`;
    case 'pull_request_read.get_comments':
      return `GET ${repoPath}/issues/${pull}/comments`;
    case 'pull_request_read.get_check_runs':
      return `GET ${repoPath}/commits/{ref}/check-runs`;
    case 'list_pull_requests.':
      return `GET ${repoPath}/pulls`;
    case 'search_pull_requests.':
      return 'GET /search/issues';
    case 'create_pull_request.':
      return `POST ${repoPath}/pulls`;
    case 'add_pull_request_comment.':
      return `POST ${repoPath}/issues/${pull}/comments`;
    case 'create_commit.':
      return GITHUB_GRAPHQL_ROUTE;
    case 'create_branch.':
      return `POST ${repoPath}/git/refs`;
    case 'update_pull_request.':
      return `PATCH ${repoPath}/pulls/${pull}`;
    case 'add_reply_to_pull_request_comment.':
      return args.reaction !== undefined && args.body === undefined
        ? `POST ${repoPath}/pulls/comments/{comment_id}/reactions`
        : `POST ${repoPath}/pulls/${pull}/comments/{comment_id}/replies`;
    case 'merge_pull_request.':
      return `PUT ${repoPath}/pulls/${pull}/merge`;
    case 'update_pull_request_branch.':
      return `PUT ${repoPath}/pulls/${pull}/update-branch`;
    case 'pull_request_review_write.create':
      return `POST ${repoPath}/pulls/${pull}/reviews`;
    case 'pull_request_review_write.submit_pending':
      return `POST ${repoPath}/pulls/${pull}/reviews/{review_id}/events`;
    case 'pull_request_review_write.delete_pending':
      return `DELETE ${repoPath}/pulls/${pull}/reviews/{review_id}`;
    case 'pull_request_review_thread_write.resolve':
      return GITHUB_GRAPHQL_ROUTE;
    case 'add_comment_to_pending_review.':
      return GITHUB_GRAPHQL_ROUTE;
    case 'actions_list.list_workflows':
      return `GET ${repoPath}/actions/workflows`;
    case 'actions_list.list_workflow_runs':
      return `GET ${repoPath}/actions/workflows/${resource}/runs`;
    case 'actions_list.list_workflow_jobs':
      return `GET ${repoPath}/actions/runs/${resource}/jobs`;
    case 'actions_list.list_workflow_run_artifacts':
      return `GET ${repoPath}/actions/runs/${resource}/artifacts`;
    case 'actions_get.get_workflow':
      return `GET ${repoPath}/actions/workflows/${resource}`;
    case 'actions_get.get_workflow_run':
      return `GET ${repoPath}/actions/runs/${resource}`;
    case 'actions_get.get_workflow_job':
      return `GET ${repoPath}/actions/jobs/${resource}`;
    case 'actions_get.download_workflow_run_artifact':
      return GITHUB_ARTIFACT_DOWNLOAD_ROUTE;
    case 'actions_get.get_workflow_run_usage':
      return `GET ${repoPath}/actions/runs/${resource}/timing`;
    case 'actions_get.get_workflow_run_logs_url':
      return `GET ${repoPath}/actions/runs/${resource}/logs`;
    case 'actions_run_trigger.run_workflow':
      return `POST ${repoPath}/actions/workflows/{workflow_id}/dispatches`;
    case 'actions_run_trigger.rerun_workflow_run':
      return `POST ${repoPath}/actions/runs/${run}/rerun`;
    case 'actions_run_trigger.rerun_failed_jobs':
      return `POST ${repoPath}/actions/runs/${run}/rerun-failed-jobs`;
    case 'actions_run_trigger.cancel_workflow_run':
      return `POST ${repoPath}/actions/runs/${run}/cancel`;
    case 'actions_run_trigger.delete_workflow_run_logs':
      return `DELETE ${repoPath}/actions/runs/${run}/logs`;
    case 'get_job_logs.':
      return `GET ${repoPath}/actions/jobs/{job_id}/logs`;
    default:
      return undefined;
  }
}

async function addCommentToPendingReview(
  client: GithubToolClient,
  args: Record<string, unknown>,
): Promise<unknown | undefined> {
  if (client.graphql === undefined) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub client does not support GraphQL operations',
    );
  }

  const review = await latestPendingReview(client, args, 'nodeId');
  if (review === undefined) return undefined;
  if (review.nodeId === undefined) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub pending pull request review did not include a node ID',
    );
  }

  const input: Record<string, unknown> = {
    pullRequestReviewId: review.nodeId,
    path: args.path,
    body: args.body,
    subjectType: args.subject_type,
  };
  if (args.line !== undefined) input.line = args.line;
  if (args.side !== undefined) input.side = args.side;
  if (args.start_line !== undefined) input.startLine = args.start_line;
  if (args.start_side !== undefined) input.startSide = args.start_side;

  return await client.graphql(ADD_PENDING_REVIEW_COMMENT_MUTATION, {input});
}

async function executeGithubGraphqlOperation(
  client: GithubToolClient,
  toolId: GithubAgentToolId,
  method: string | undefined,
  parameters: Record<string, unknown>,
): Promise<unknown | undefined> {
  if (client.graphql === undefined) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub client does not support GraphQL operations',
    );
  }

  switch (`${toolId}.${method ?? ''}`) {
    case 'pull_request_read.get_review_threads': {
      const variables: Record<string, unknown> = {
        owner: parameters.owner,
        repo: parameters.repo,
        pullNumber: parameters.pull_number,
      };
      if (typeof parameters.cursor === 'string') variables.after = parameters.cursor;
      return await client.graphql(GET_PULL_REQUEST_REVIEW_THREADS_QUERY, variables);
    }
    case 'pull_request_review_thread_write.resolve':
      return await client.graphql(RESOLVE_PULL_REQUEST_REVIEW_THREAD_MUTATION, {
        input: {threadId: parameters.thread_id},
      });
    case 'add_comment_to_pending_review.':
      return await addCommentToPendingReview(client, parameters);
    case 'create_commit.':
      return await createCommitOnBranch(client, parameters);
    default:
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub operation does not support GraphQL operations',
      );
  }
}

const CREATE_COMMIT_STALE_HEAD_TYPE_PATTERN = /^STALE_(HEAD_OID|DATA)$/u;
const CREATE_COMMIT_STALE_HEAD_MESSAGE_PATTERN = /Expected branch to point to/u;
const CREATE_COMMIT_RATE_LIMITED_TYPE = 'RATE_LIMITED';
const CREATE_COMMIT_REPOSITORY_PATTERN = /^[^/\s]+\/[^/\s]+$/u;
const CREATE_COMMIT_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const CREATE_COMMIT_ENCODINGS = new Set(['utf8', 'base64']);
const CREATE_COMMIT_UNPAIRED_SURROGATE_PATTERN = /[\uD800-\uDFFF]/u;
const CREATE_COMMIT_BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;

async function createCommitOnBranch(
  client: GithubToolClient,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const graphql = client.graphql;
  if (graphql === undefined) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub client does not support GraphQL operations',
    );
  }
  const message = isRecord(parameters.message) ? parameters.message : undefined;
  const additions = Array.isArray(parameters.additions)
    ? parameters.additions.filter(isRecord)
    : [];
  const deletions = Array.isArray(parameters.deletions)
    ? parameters.deletions.filter(isRecord)
    : [];
  const input = {
    branch: {
      repositoryNameWithOwner: parameters.repository,
      branchName: parameters.branch,
    },
    expectedHeadOid: parameters.expected_head_oid,
    message: {
      headline: message?.headline,
      ...(message?.body === undefined ? {} : {body: message.body}),
    },
    fileChanges: {
      additions: additions.map(transcodeFileAddition),
      deletions: deletions.map((deletion) => ({path: deletion.path})),
    },
  };

  try {
    return await graphql(CREATE_COMMIT_ON_BRANCH_MUTATION, {input});
  } catch (error) {
    throw mapCreateCommitError(error, parameters.expected_head_oid);
  }
}

function transcodeFileAddition(addition: Record<string, unknown>): Record<string, unknown> {
  const contents = typeof addition.contents === 'string' ? addition.contents : '';
  const contentsBase64 =
    addition.encoding === 'base64' ? contents : Buffer.from(contents, 'utf8').toString('base64');
  return {path: addition.path, contents: contentsBase64};
}

function mapCreateCommitError(error: unknown, expectedHeadOid: unknown): never {
  const graphqlErrors = createCommitGraphqlErrors(error);
  if (graphqlErrors.length === 0) throw error;
  const rateLimited = graphqlErrors.find(
    (graphqlError) => graphqlError.type === CREATE_COMMIT_RATE_LIMITED_TYPE,
  );
  if (rateLimited !== undefined) {
    throw new GithubIntegrationProviderError(
      'rate-limited',
      rateLimited.message,
      createCommitRateLimitRetryAfterSeconds(error),
      githubGraphqlResponseStatus(error),
    );
  }
  const staleHead = graphqlErrors.find(isStaleHeadCreateCommitError);
  if (staleHead !== undefined) {
    throw new GithubIntegrationProviderError(
      'provider-rejected',
      `Stale branch head (stale-head): expected_head_oid ${String(expectedHeadOid)} did not match the branch tip. ${staleHead.message}`,
    );
  }
  const first = graphqlErrors[0];
  if (first === undefined) throw error;
  throw new GithubIntegrationProviderError('provider-rejected', first.message);
}

interface CreateCommitGraphqlError {
  type?: string | undefined;
  message: string;
}

function createCommitGraphqlErrors(error: unknown): CreateCommitGraphqlError[] {
  if (!isRecord(error) || !Array.isArray(error.errors)) return [];
  const graphqlErrors: CreateCommitGraphqlError[] = [];
  for (const entry of error.errors) {
    if (!isRecord(entry) || typeof entry.message !== 'string') continue;
    graphqlErrors.push({
      ...(typeof entry.type === 'string' ? {type: entry.type} : {}),
      message: entry.message,
    });
  }
  return graphqlErrors;
}

function createCommitRateLimitRetryAfterSeconds(error: unknown): number | undefined {
  const headers = githubGraphqlResponseHeaders(error);
  if (headers === undefined) return undefined;
  const retryAfter = parseCreateCommitHeaderSeconds(headers['retry-after']);
  if (retryAfter !== undefined) return retryAfter;
  const resetAt = parseCreateCommitHeaderSeconds(headers['x-ratelimit-reset']);
  if (resetAt === undefined) return undefined;
  const seconds = resetAt - Math.floor(Date.now() / 1000);
  return seconds > 0 ? seconds : undefined;
}

function githubGraphqlResponseHeaders(error: unknown): Record<string, unknown> | undefined {
  if (!isRecord(error) || !isRecord(error.response)) return undefined;
  return isRecord(error.response.headers) ? error.response.headers : undefined;
}

function githubGraphqlResponseStatus(error: unknown): number | undefined {
  if (!isRecord(error) || !isRecord(error.response)) return undefined;
  return typeof error.response.status === 'number' ? error.response.status : undefined;
}

function parseCreateCommitHeaderSeconds(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isStaleHeadCreateCommitError(error: {
  type?: string | undefined;
  message: string;
}): boolean {
  return (
    (error.type !== undefined && CREATE_COMMIT_STALE_HEAD_TYPE_PATTERN.test(error.type)) ||
    CREATE_COMMIT_STALE_HEAD_MESSAGE_PATTERN.test(error.message)
  );
}

export function projectGithubOperationParameters(
  toolId: GithubAgentToolId,
  method: string | undefined,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (toolId === 'search_issues' || toolId === 'search_pull_requests') {
    return projectGithubSearchOperationParameters(args);
  }
  const parameters = {...args};
  if (toolId === 'add_issue_comment' && parameters.reaction !== undefined) {
    parameters.content = parameters.reaction;
    delete parameters.reaction;
    if (parameters.body === undefined) delete parameters.body;
  }
  if (toolId === 'pull_request_read' && method === 'get_diff') {
    parameters.headers = {accept: 'application/vnd.github.diff'};
  }
  return parameters;
}

function projectGithubSearchOperationParameters(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const {query, owner, repo, ...parameters} = args;
  if (typeof owner !== 'string' || typeof repo !== 'string') {
    return {...parameters, q: query};
  }

  const scopeQualifier = `repo:${owner}/${repo}`;
  return {
    ...parameters,
    q:
      typeof query === 'string' && query.trim().length > 0
        ? [query, scopeQualifier].join(' ')
        : scopeQualifier,
  };
}

async function resolveGithubOperationParameters(
  client: GithubToolClient,
  parameters: Record<string, unknown>,
  toolId: GithubAgentToolId,
  method: string | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (isPendingReviewOperation(toolId, method)) {
    const review = await latestPendingReview(client, parameters, 'id');
    if (review === undefined) return undefined;
    if (review.id === undefined) {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub pending pull request review did not include a numeric ID',
      );
    }
    return {...parameters, review_id: review.id};
  }
  if (toolId === 'create_branch') return resolveCreateBranchParameters(client, parameters);
  return parameters;
}

function isPendingReviewOperation(toolId: GithubAgentToolId, method: string | undefined): boolean {
  return (
    toolId === 'pull_request_review_write' &&
    (method === 'submit_pending' || method === 'delete_pending')
  );
}

const GITHUB_COMMIT_OID_PATTERN = /^[0-9a-f]{40}$/iu;

async function executeGithubRestOperation(
  client: GithubToolClient,
  route: string,
  parameters: Record<string, unknown>,
  toolId: GithubAgentToolId,
): Promise<GithubToolResponse> {
  if (toolId === 'create_branch') return await createGitBranch(client, parameters);
  return await client.request(route, parameters);
}

async function resolveCreateBranchParameters(
  client: GithubToolClient,
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const {owner, repo} = splitRepositoryName(parameters.repository);
  const branch = parameters.branch;
  if (typeof branch !== 'string' || branch.length === 0 || branch.startsWith('refs/')) {
    throw new GithubIntegrationProviderError(
      'ref-invalid',
      'Parameter branch must be a non-empty branch name without a refs/ prefix',
    );
  }
  const from = parameters.from;
  if (typeof from !== 'string' || from.length === 0) {
    throw new GithubIntegrationProviderError(
      'ref-invalid',
      'Parameter from must be a 40-character commit oid or a branch name',
    );
  }
  if (from.startsWith('refs/')) {
    throw new GithubIntegrationProviderError(
      'ref-invalid',
      'Parameter from must be a 40-character commit oid or a branch name without a refs/ prefix',
    );
  }
  const sha = GITHUB_COMMIT_OID_PATTERN.test(from)
    ? from
    : await resolveBranchHeadOid(client, owner, repo, from);
  const {repository: _repository, from: _from, ...rest} = parameters;
  return {...rest, owner, repo, sha};
}

async function resolveBranchHeadOid(
  client: GithubToolClient,
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  let response: GithubToolResponse;
  try {
    response = await mapGithubError(
      () =>
        client.request('GET /repos/{owner}/{repo}/git/ref/heads/{branch}', {
          owner,
          repo,
          branch,
        }),
      'ref-not-found',
    );
  } catch (error) {
    if (error instanceof GithubIntegrationProviderError && error.status === 404) {
      throw new GithubIntegrationProviderError(
        'provider-rejected',
        `Branch '${branch}' does not exist in repository ${owner}/${repo}; from must be a 40-character commit oid or an existing branch name`,
        undefined,
        error.status,
      );
    }
    throw error;
  }

  const data = response.data;
  if (!isRecord(data)) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub branch head resolution response was malformed',
    );
  }
  const object = data.object;
  if (!isRecord(object)) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub branch head resolution response was malformed',
    );
  }
  const sha = object.sha;
  if (typeof sha !== 'string' || !GITHUB_COMMIT_OID_PATTERN.test(sha)) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub branch head resolution response was malformed',
    );
  }
  return sha;
}

async function createGitBranch(
  client: GithubToolClient,
  parameters: Record<string, unknown>,
): Promise<GithubToolResponse> {
  const branch = parameters.branch;
  const owner = parameters.owner;
  const repo = parameters.repo;
  const sha = parameters.sha;
  let response: GithubToolResponse;
  try {
    response = await mapGithubError(() =>
      client.request('POST /repos/{owner}/{repo}/git/refs', {
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha,
      }),
    );
  } catch (error) {
    if (
      error instanceof GithubIntegrationProviderError &&
      error.status === 422 &&
      isAlreadyExistsMessage(error.message)
    ) {
      return await reconcileExistingBranch(client, owner, repo, branch, sha);
    }
    throw error;
  }
  return response;
}

async function reconcileExistingBranch(
  client: GithubToolClient,
  owner: unknown,
  repo: unknown,
  branch: unknown,
  sha: unknown,
): Promise<GithubToolResponse> {
  try {
    const existing = await mapGithubError(() =>
      client.request('GET /repos/{owner}/{repo}/git/ref/heads/{branch}', {
        owner,
        repo,
        branch,
      }),
    );
    const object =
      isRecord(existing.data) && isRecord(existing.data.object) ? existing.data.object : undefined;
    if (
      typeof sha === 'string' &&
      typeof object?.sha === 'string' &&
      object.sha.toLowerCase() === sha.toLowerCase()
    ) {
      return existing;
    }
  } catch (error) {
    if (!(error instanceof GithubIntegrationProviderError && error.status === 404)) {
      throw error;
    }
    // Fall through to the already-exists rejection when the existing ref cannot be read.
  }
  throw new GithubIntegrationProviderError(
    'provider-rejected',
    `Branch '${branch}' already exists in repository ${owner}/${repo}`,
    undefined,
    422,
  );
}

function isAlreadyExistsMessage(message: string): boolean {
  return message.toLowerCase().includes('already exists');
}

function splitRepositoryName(value: unknown): {owner: string; repo: string} {
  if (typeof value !== 'string') {
    throw new GithubIntegrationProviderError(
      'ref-invalid',
      'Parameter repository must be a string in owner/name form',
    );
  }
  const slashIndex = value.indexOf('/');
  if (slashIndex < 1 || slashIndex !== value.lastIndexOf('/') || slashIndex === value.length - 1) {
    throw new GithubIntegrationProviderError(
      'ref-invalid',
      `Parameter repository must be a string in owner/name form: ${value}`,
    );
  }
  return {owner: value.slice(0, slashIndex), repo: value.slice(slashIndex + 1)};
}

interface PendingReviewReference {
  id?: number | undefined;
  nodeId?: string | undefined;
}

type PendingReviewIdentifier = keyof PendingReviewReference;

interface PendingReviewPageResult {
  malformed: boolean;
  review?: PendingReviewReference | undefined;
}

async function latestPendingReview(
  client: GithubToolClient,
  parameters: Record<string, unknown>,
  requiredIdentifier: PendingReviewIdentifier,
): Promise<PendingReviewReference | undefined> {
  const lookupController = new AbortController();
  const lookupTimeout = setTimeout(
    () => lookupController.abort(),
    PENDING_REVIEW_LOOKUP_TIMEOUT_MS,
  );

  try {
    return await latestPendingReviewBeforeDeadline(
      client,
      parameters,
      requiredIdentifier,
      lookupController.signal,
    );
  } finally {
    clearTimeout(lookupTimeout);
  }
}

async function latestPendingReviewBeforeDeadline(
  client: GithubToolClient,
  parameters: Record<string, unknown>,
  requiredIdentifier: PendingReviewIdentifier,
  lookupSignal: AbortSignal,
): Promise<PendingReviewReference | undefined> {
  const firstPage = await requestPendingReviewPage(client, parameters, 1, lookupSignal);
  const lastPage = pendingReviewLastPage(firstPage.headers);
  let requests = 1;
  let malformed = false;

  for (let page = lastPage; page >= 1; page -= 1) {
    let response = firstPage;
    if (page !== 1) {
      if (requests >= PENDING_REVIEW_MAX_PAGE_REQUESTS) {
        throw new GithubIntegrationProviderError(
          'content-too-large',
          'GitHub pull request review history exceeded the pending review lookup limit',
        );
      }
      response = await requestPendingReviewPage(client, parameters, page, lookupSignal);
      requests += 1;
    }
    if (!Array.isArray(response.data)) {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub pull request review list response was malformed',
      );
    }

    const result = latestPendingReviewOnPage(response.data, requiredIdentifier);
    if (result.review !== undefined) return result.review;
    malformed ||= result.malformed;
  }

  if (malformed) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      requiredIdentifier === 'nodeId'
        ? 'GitHub pending pull request review did not include a node ID'
        : 'GitHub pending pull request review did not include a numeric ID',
    );
  }
  return undefined;
}

async function requestPendingReviewPage(
  client: GithubToolClient,
  parameters: Record<string, unknown>,
  page: number,
  lookupSignal: AbortSignal,
): Promise<GithubToolResponse> {
  const pageController = new AbortController();
  const abortPage = () => pageController.abort();
  if (lookupSignal.aborted) abortPage();
  else lookupSignal.addEventListener('abort', abortPage, {once: true});
  const pageTimeout = setTimeout(abortPage, PENDING_REVIEW_PAGE_TIMEOUT_MS);

  try {
    return await client.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
      owner: parameters.owner,
      repo: parameters.repo,
      pull_number: parameters.pull_number,
      per_page: PENDING_REVIEW_PAGE_SIZE,
      page,
      request: {signal: pageController.signal},
    });
  } finally {
    clearTimeout(pageTimeout);
    lookupSignal.removeEventListener('abort', abortPage);
  }
}

function pendingReviewLastPage(headers: GithubToolResponse['headers']): number {
  const link = headers?.link;
  if (typeof link !== 'string') return 1;
  const lastLink = link.split(',').find((part) => part.includes('rel="last"'));
  if (lastLink === undefined) return 1;
  const match = PENDING_REVIEW_PAGE_PATTERN.exec(lastLink);
  const page = match?.[1] === undefined ? Number.NaN : Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub pull request review pagination response was malformed',
    );
  }
  return page;
}

function latestPendingReviewOnPage(
  data: readonly unknown[],
  requiredIdentifier: PendingReviewIdentifier,
): PendingReviewPageResult {
  let malformed = false;
  const appLogin = githubAppBotLogin().toLowerCase();
  for (let index = data.length - 1; index >= 0; index -= 1) {
    const review = data[index];
    if (!isRecord(review) || review.state !== 'PENDING') continue;
    const candidate = pendingReviewCandidate(review, appLogin);
    if (candidate === 'malformed') {
      malformed = true;
      continue;
    }
    if (candidate === undefined) continue;
    if (candidate[requiredIdentifier] !== undefined) return {malformed, review: candidate};
    malformed = true;
  }

  return {malformed};
}

function pendingReviewCandidate(
  review: Record<string, unknown>,
  appLogin: string,
): PendingReviewReference | 'malformed' | undefined {
  const userLogin = isRecord(review.user) ? review.user.login : undefined;
  if (typeof userLogin !== 'string' || userLogin.trim().length === 0) return 'malformed';
  if (userLogin.trim().toLowerCase() !== appLogin) return undefined;
  const id =
    typeof review.id === 'number' && Number.isSafeInteger(review.id) && review.id > 0
      ? review.id
      : undefined;
  const nodeId =
    typeof review.node_id === 'string' && review.node_id.trim().length > 0
      ? review.node_id.trim()
      : undefined;
  return {id, nodeId};
}

function githubToolResult(
  toolId: GithubAgentToolId,
  data: unknown,
  response?: GithubToolResponse,
  parameters?: Record<string, unknown>,
  route?: string,
): GithubToolCallResult {
  const structuredContent = projectGithubToolOutput(toolId, data, response, parameters, route);
  if (structuredContent === undefined) {
    return githubToolError(
      'GitHub artifact download did not return a download URL',
      'malformed-provider-response',
    );
  }
  return {
    content: [{type: 'text', text: JSON.stringify(structuredContent)}],
    structuredContent,
  };
}

function projectGithubToolOutput(
  toolId: GithubAgentToolId,
  data: unknown,
  response?: GithubToolResponse,
  parameters?: Record<string, unknown>,
  route?: string,
): Record<string, unknown> | undefined {
  if (route === GITHUB_ARTIFACT_DOWNLOAD_ROUTE) {
    return projectGithubArtifactDownloadOutput(response, parameters);
  }

  switch (toolId) {
    case 'list_issue_types':
      return {issue_types: data};
    case 'list_issues':
      return {issues: data};
    case 'search_issues':
      return {issues: githubSearchItems(data)};
    case 'list_pull_requests':
      return {pull_requests: data};
    case 'search_pull_requests':
      return {pull_requests: githubSearchItems(data)};
    case 'create_pull_request':
    case 'update_pull_request':
      return {pull_request: data};
    case 'create_branch':
      return projectGithubCreateBranchOutput(data);
    case 'merge_pull_request':
      return {merge: data};
    case 'create_commit': {
      const payload = isRecord(data) ? data.createCommitOnBranch : undefined;
      const commit = isRecord(payload) ? payload.commit : undefined;
      if (!isRecord(commit) || typeof commit.oid !== 'string' || typeof commit.url !== 'string') {
        throw new GithubIntegrationProviderError(
          'malformed-provider-response',
          'GitHub createCommitOnBranch response did not include a commit oid and url',
        );
      }
      return {commit: {oid: commit.oid, url: commit.url}};
    }
    default:
      return isRecord(data) ? data : {result: data};
  }
}

function projectGithubCreateBranchOutput(data: unknown): Record<string, unknown> {
  if (!isRecord(data)) throw malformedCreateBranchResponse();

  const ref = data.ref;
  if (typeof ref !== 'string' || !ref.startsWith('refs/heads/')) {
    throw malformedCreateBranchResponse();
  }
  const branch = ref.slice('refs/heads/'.length);

  if (!isRecord(data.object) || typeof data.object.sha !== 'string') {
    throw malformedCreateBranchResponse();
  }
  const oid = data.object.sha;

  if (typeof data.url !== 'string') throw malformedCreateBranchResponse();

  return {branch, oid, url: data.url};
}

function malformedCreateBranchResponse(): GithubIntegrationProviderError {
  return new GithubIntegrationProviderError(
    'malformed-provider-response',
    'GitHub create branch response was malformed',
  );
}

function projectGithubArtifactDownloadOutput(
  response: GithubToolResponse | undefined,
  parameters: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (response === undefined) return undefined;
  const downloadUrl = response.headers?.location;
  if (typeof downloadUrl !== 'string' || downloadUrl.length === 0) return undefined;

  const output: Record<string, unknown> = {
    archive_format: GITHUB_ARTIFACT_ARCHIVE_FORMAT,
    download_url: downloadUrl,
  };
  if (typeof parameters?.resource_id === 'string') output.artifact_id = parameters.resource_id;

  const contentType = response.headers?.['content-type'];
  if (typeof contentType === 'string') output.content_type = contentType;

  const contentLength = response.headers?.['content-length'];
  const sizeBytes = typeof contentLength === 'number' ? contentLength : Number(contentLength);
  if (Number.isSafeInteger(sizeBytes) && sizeBytes >= 0) output.size_bytes = sizeBytes;

  return output;
}

function githubSearchItems(data: unknown): unknown {
  return isRecord(data) ? data.items : data;
}

function githubToolError(message: string, code: GithubToolErrorCode): GithubToolCallResult {
  return {
    isError: true,
    content: [{type: 'text', text: message}],
    structuredContent: {code},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateGithubToolArguments(
  tool: AgentToolCatalogEntry<GithubAgentToolRequiredScope>,
  arguments_: Record<string, unknown>,
): string | GithubToolValidationError | undefined {
  const missingParameter = validateMissingGithubToolArgument(tool.inputSchema, arguments_);
  if (missingParameter !== undefined) return missingParameter;

  const searchValidationError = validateGithubSearchArgumentsForTool(tool.id, arguments_);
  if (searchValidationError !== undefined) return searchValidationError;

  const argumentValidationError = validateGithubArgumentProperties(tool.inputSchema, arguments_);
  if (argumentValidationError !== undefined) return argumentValidationError;

  return tool.id === 'create_commit' ? validateCreateCommitArguments(arguments_) : undefined;
}

function validateMissingGithubToolArgument(
  inputSchema: AgentToolCatalogEntry<GithubAgentToolRequiredScope>['inputSchema'],
  arguments_: Record<string, unknown>,
): string | undefined {
  const required = Array.isArray(inputSchema.required) ? inputSchema.required : [];
  for (const name of required) {
    if (typeof name === 'string' && arguments_[name] === undefined) {
      return `Missing required parameter: ${name}`;
    }
  }

  const methodRequired = methodRequiredParameters(inputSchema, arguments_);
  for (const name of methodRequired) {
    if (arguments_[name] === undefined) return `Missing required parameter: ${name}`;
  }

  return undefined;
}

function validateGithubSearchArgumentsForTool(
  toolId: string,
  arguments_: Record<string, unknown>,
): GithubToolValidationError | undefined {
  return toolId === 'search_issues' || toolId === 'search_pull_requests'
    ? validateGithubSearchArguments(arguments_)
    : undefined;
}

function validateGithubArgumentProperties(
  inputSchema: AgentToolCatalogEntry<GithubAgentToolRequiredScope>['inputSchema'],
  arguments_: Record<string, unknown>,
): string | undefined {
  const properties = inputSchema.properties;
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    return undefined;
  }
  const propertySchemas = properties as Record<string, unknown>;
  for (const [name, value] of Object.entries(arguments_)) {
    const invalid = validateGithubArgument(name, value, propertySchemas[name]);
    if (invalid !== undefined) return invalid;
  }
  return undefined;
}

interface GithubToolValidationError {
  message: string;
  code: GithubToolErrorCode;
}

function validateGithubSearchArguments(
  arguments_: Record<string, unknown>,
): GithubToolValidationError | undefined {
  if (typeof arguments_.query !== 'string' || arguments_.query.trim().length === 0) {
    return {message: 'Parameter query must be a non-empty string', code: 'invalid-request'};
  }

  const hasOwner = arguments_.owner !== undefined;
  const hasRepo = arguments_.repo !== undefined;
  if (hasOwner !== hasRepo) {
    return {
      message: 'Parameters owner and repo must be provided together',
      code: 'invalid-request',
    };
  }
  if (hasOwner && (typeof arguments_.owner !== 'string' || typeof arguments_.repo !== 'string')) {
    return {
      message: 'Parameters owner and repo must be strings',
      code: 'invalid-request',
    };
  }
  if (hasOwner && (arguments_.owner === '' || arguments_.repo === '')) {
    return {
      message: 'Parameters owner and repo must be non-empty strings',
      code: 'invalid-request',
    };
  }
  if (
    hasOwner &&
    (GITHUB_REPOSITORY_PART_UNSAFE_PATTERN.test(arguments_.owner as string) ||
      GITHUB_REPOSITORY_PART_UNSAFE_PATTERN.test(arguments_.repo as string))
  ) {
    return {
      message: 'Parameters owner and repo must be valid repository name parts',
      code: 'invalid-request',
    };
  }
  if (hasUnquotedGithubSearchScopeQualifier(arguments_.query)) {
    return {
      message: 'Search query cannot contain repo:, org:, or user: qualifiers',
      code: 'search-qualifier-conflict',
    };
  }
  return undefined;
}

function validateGithubArgument(name: string, value: unknown, schema: unknown): string | undefined {
  if (!isRecord(schema)) return undefined;
  if (schema.type === 'integer' && (!Number.isInteger(value) || typeof value !== 'number')) {
    return `Parameter ${name} must be an integer`;
  }
  if (schema.type === 'array' && !Array.isArray(value)) return `Parameter ${name} must be an array`;
  return undefined;
}

const GITHUB_REPOSITORY_PART_UNSAFE_PATTERN = /[\s/:\\]/u;
const GITHUB_SEARCH_SCOPE_QUALIFIER_PATTERN = /(?:^|\s)-?(?:repo|org|user):/iu;

function hasUnquotedGithubSearchScopeQualifier(query: string): boolean {
  let quoted = false;
  let escaped = false;
  let unquotedQuery = '';

  for (const character of query) {
    if (escaped) {
      if (!quoted) unquotedQuery += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      if (!quoted) unquotedQuery += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted) unquotedQuery += character;
  }

  return GITHUB_SEARCH_SCOPE_QUALIFIER_PATTERN.test(unquotedQuery);
}

function validateCreateCommitArguments(arguments_: Record<string, unknown>): string | undefined {
  const metadataError = validateCreateCommitMetadata(arguments_);
  if (metadataError !== undefined) return metadataError;
  return validateCreateCommitChanges(arguments_.additions, arguments_.deletions);
}

function validateCreateCommitMetadata(arguments_: Record<string, unknown>): string | undefined {
  const repository = arguments_.repository;
  if (typeof repository !== 'string' || !CREATE_COMMIT_REPOSITORY_PATTERN.test(repository)) {
    return 'Parameter repository must be a repository in owner/name format';
  }
  const branch = arguments_.branch;
  if (typeof branch !== 'string' || branch.trim().length === 0) {
    return 'Parameter branch must be a non-empty branch name';
  }
  const expectedHeadOid = arguments_.expected_head_oid;
  if (typeof expectedHeadOid !== 'string' || !CREATE_COMMIT_OID_PATTERN.test(expectedHeadOid)) {
    return 'Parameter expected_head_oid must be a 40- or 64-character commit oid';
  }
  const message = arguments_.message;
  if (
    !isRecord(message) ||
    typeof message.headline !== 'string' ||
    message.headline.trim().length === 0 ||
    (message.body !== undefined && typeof message.body !== 'string')
  ) {
    return 'Parameter message must be an object with a headline string and optional body string';
  }
  return undefined;
}

function validateCreateCommitChanges(additions: unknown, deletions: unknown): string | undefined {
  if (additions !== undefined && !isFileAdditionList(additions)) {
    return 'Parameter additions must be an array of {path, contents, encoding?} objects';
  }
  if (deletions !== undefined && !isFileDeletionList(deletions)) {
    return 'Parameter deletions must be an array of {path} objects';
  }
  if (
    Array.isArray(additions) &&
    additions.length > 0 &&
    createCommitAdditionsByteLength(additions) > MAX_REPOSITORY_FILE_BYTES
  ) {
    return 'Parameter additions must fit within the 1 MiB payload bound per call';
  }
  if (
    (!Array.isArray(additions) || additions.length === 0) &&
    (!Array.isArray(deletions) || deletions.length === 0)
  ) {
    return 'At least one addition or deletion is required to create a commit';
  }
  return undefined;
}

function isFileAdditionList(value: unknown): value is readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return false;
  return value.every(isFileAddition);
}

function isFileAddition(item: unknown): item is Record<string, unknown> {
  if (!isRecord(item)) return false;
  if (typeof item.path !== 'string' || !isSafeRepositoryPath(item.path)) return false;
  if (typeof item.contents !== 'string') return false;
  if (item.encoding === undefined) {
    return !CREATE_COMMIT_UNPAIRED_SURROGATE_PATTERN.test(item.contents);
  }
  if (typeof item.encoding !== 'string' || !CREATE_COMMIT_ENCODINGS.has(item.encoding))
    return false;
  if (item.encoding === 'base64') return isWellFormedBase64(item.contents);
  return !CREATE_COMMIT_UNPAIRED_SURROGATE_PATTERN.test(item.contents);
}

function isFileDeletionList(value: unknown): value is readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) => isRecord(item) && typeof item.path === 'string' && isSafeRepositoryPath(item.path),
  );
}

function isSafeRepositoryPath(path: string): boolean {
  if (path.startsWith('/') || path.includes('\\')) return false;
  if (containsCreateCommitControlCharacter(path)) return false;
  return path.split('/').every((segment) => {
    return segment.length > 0 && segment !== '.' && segment !== '..' && segment !== '.git';
  });
}

function containsCreateCommitControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isWellFormedBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  if (!CREATE_COMMIT_BASE64_PATTERN.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function createCommitAdditionsByteLength(additions: readonly Record<string, unknown>[]): number {
  return additions.reduce((total, addition) => total + createCommitAdditionByteLength(addition), 0);
}

function createCommitAdditionByteLength(addition: Record<string, unknown>): number {
  const contents = typeof addition.contents === 'string' ? addition.contents : '';
  return addition.encoding === 'base64'
    ? Buffer.from(contents, 'base64').byteLength
    : Buffer.byteLength(contents, 'utf8');
}

function methodRequiredParameters(
  inputSchema: AgentToolCatalogEntry<GithubAgentToolRequiredScope>['inputSchema'],
  arguments_: Record<string, unknown>,
): string[] {
  const method = arguments_.method;
  if (typeof method !== 'string' || !Array.isArray(inputSchema.oneOf)) return [];

  for (const candidate of inputSchema.oneOf) {
    if (!isRecord(candidate) || !isRecord(candidate.properties)) continue;
    const methodSchema = candidate.properties.method;
    if (!isRecord(methodSchema) || methodSchema.const !== method) continue;
    return Array.isArray(candidate.required)
      ? candidate.required.filter((name): name is string => typeof name === 'string')
      : [];
  }

  return [];
}

function githubPermissionDeniedMessage(
  tool: AgentToolCatalogEntry<GithubAgentToolRequiredScope>,
  call: AgentToolCallInput,
): string {
  const method = typeof call.arguments.method === 'string' ? call.arguments.method : undefined;
  const required =
    tool.methods?.find((candidate) => candidate.id === method)?.requiredScope ?? tool.requiredScope;
  const scope = required.map(({permission, access}) => `${permission}: ${access}`).join(', ');
  return `GitHub installation token is missing permission for this operation: ${tool.id} requires ${scope}`;
}

function hasGrantedPermissions(
  granted: Record<string, 'read' | 'write' | 'admin'>,
  tool: AgentToolCatalogEntry<GithubAgentToolRequiredScope>,
  call: AgentToolCallInput,
): boolean {
  const method = typeof call.arguments.method === 'string' ? call.arguments.method : undefined;
  const required =
    tool.methods?.find((candidate) => candidate.id === method)?.requiredScope ?? tool.requiredScope;
  return required.every(({permission, access}) => {
    const actual = granted[permission];
    return actual === 'write' || actual === 'admin' || actual === access;
  });
}
