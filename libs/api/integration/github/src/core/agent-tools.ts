import type {
  AgentToolCallInput,
  AgentToolCatalogEntry,
  AgentToolSelectionCatalog,
  AgentToolSession,
  AgentToolsProvider,
  IntegrationConnection,
  OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';
import {Octokit} from 'octokit';
import {mapGithubError} from '#api/client.js';
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
} from './github-agent-tool-catalog.js';

type GithubIntegrationConnection = IntegrationConnection<'github'>;

type GithubToolCallResult = {
  isError?: boolean | undefined;
  content: readonly {type: 'text'; text: string}[];
  structuredContent?: Record<string, unknown> | undefined;
};

type GithubToolErrorCode =
  | 'invalid-request'
  | 'access-denied'
  | 'provider-rejected'
  | 'malformed-provider-response';

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

const CREATE_COMMIT_ON_BRANCH_MUTATION = `
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
      unknown,
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
    input: OpenAgentToolsSessionInput<GithubIntegrationConnection, GithubAgentToolRequiredScope>,
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
    let tokenPromise:
      | ReturnType<GithubInstallationTokenProvider['getInstallationAccessToken']>
      | undefined;

    return {
      call: async (call) => {
        const tool = input.tools.find((candidate) => candidate.id === call.toolId);
        if (!tool) return githubToolError(`Unknown GitHub tool: ${call.toolId}`, 'invalid-request');
        const operation = resolveGithubOperation(tool, call);
        if (operation === undefined)
          return githubToolError('Unknown GitHub tool operation', 'invalid-request');
        const validationError = validateGithubToolArguments(tool, call.arguments);
        if (validationError) return githubToolError(validationError, 'invalid-request');
        tokenPromise ??= this.tokenProvider.getInstallationAccessToken(installationId);
        const token = await tokenPromise;
        if (!hasGrantedPermissions(token.permissions ?? {}, tool, call)) {
          return githubToolError(
            'GitHub installation token is missing permission for this operation',
            'access-denied',
          );
        }
        const client = (this.options.createClient ?? createOctokitClient)(token.token);
        const method =
          typeof call.arguments.method === 'string' ? call.arguments.method : undefined;

        if (operation.kind === 'graphql') {
          const data = await mapGithubError(() =>
            executeGithubGraphqlOperation(
              client,
              tool.id as GithubAgentToolId,
              method,
              operation.parameters,
            ),
          );
          if (data === undefined && tool.id === 'add_comment_to_pending_review') {
            return githubToolError(NO_PENDING_REVIEW_MESSAGE, 'provider-rejected');
          }
          return githubToolResult(tool.id as GithubAgentToolId, data);
        }

        const operationParameters = await mapGithubError(() =>
          resolvePendingReviewParameters(
            client,
            operation.parameters,
            tool.id as GithubAgentToolId,
            method,
          ),
        );
        if (operationParameters === undefined) {
          return githubToolError(NO_PENDING_REVIEW_MESSAGE, 'provider-rejected');
        }
        const response = await mapGithubError(() =>
          client.request(operation.route, operationParameters),
        );
        return githubToolResult(
          tool.id as GithubAgentToolId,
          response.data,
          response,
          operationParameters,
          operation.route,
        );
      },
    };
  }
}

export interface GithubAgentToolsProviderOptions {
  getInstallationByConnectionId?:
    | ((connectionId: string) => Promise<GithubInstallation | undefined>)
    | undefined;
  tokenProvider?: GithubInstallationTokenProvider | undefined;
  createClient?: GithubToolClientFactory | undefined;
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
    case 'create_commit.':
      return GITHUB_GRAPHQL_ROUTE;
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
const CREATE_COMMIT_OID_PATTERN = /^[0-9a-f]{40}$/iu;
const CREATE_COMMIT_ENCODINGS = new Set(['utf8', 'base64']);

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
  const graphqlError = createCommitGraphqlError(error);
  if (graphqlError === undefined) throw error;
  if (graphqlError.type === CREATE_COMMIT_RATE_LIMITED_TYPE) {
    throw new GithubIntegrationProviderError('rate-limited', graphqlError.message);
  }
  if (isStaleHeadCreateCommitError(graphqlError)) {
    throw new GithubIntegrationProviderError(
      'provider-rejected',
      `Stale branch head (stale-head): expected_head_oid ${String(expectedHeadOid)} did not match the branch tip. ${graphqlError.message}`,
    );
  }
  throw new GithubIntegrationProviderError('provider-rejected', graphqlError.message);
}

function createCommitGraphqlError(
  error: unknown,
): {type?: string | undefined; message: string} | undefined {
  if (!isRecord(error) || !Array.isArray(error.errors)) return undefined;
  const first = error.errors[0];
  if (!isRecord(first) || typeof first.message !== 'string') return undefined;
  return {
    ...(typeof first.type === 'string' ? {type: first.type} : {}),
    message: first.message,
  };
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

async function resolvePendingReviewParameters(
  client: GithubToolClient,
  parameters: Record<string, unknown>,
  toolId: GithubAgentToolId,
  method: string | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!isPendingReviewOperation(toolId, method)) return parameters;

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

function isPendingReviewOperation(toolId: GithubAgentToolId, method: string | undefined): boolean {
  return (
    toolId === 'pull_request_review_write' &&
    (method === 'submit_pending' || method === 'delete_pending')
  );
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
    const userLogin = isRecord(review.user) ? review.user.login : undefined;
    if (typeof userLogin !== 'string' || userLogin.trim().length === 0) {
      malformed = true;
      continue;
    }
    if (userLogin.trim().toLowerCase() !== appLogin) continue;
    const id =
      typeof review.id === 'number' && Number.isSafeInteger(review.id) && review.id > 0
        ? review.id
        : undefined;
    const nodeId =
      typeof review.node_id === 'string' && review.node_id.trim().length > 0
        ? review.node_id.trim()
        : undefined;
    const reference = {id, nodeId};
    if (reference[requiredIdentifier] !== undefined) return {malformed, review: reference};
    malformed = true;
  }

  return {malformed};
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
): string | undefined {
  const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [];
  for (const name of required) {
    if (typeof name === 'string' && arguments_[name] === undefined) {
      return `Missing required parameter: ${name}`;
    }
  }

  const methodRequired = methodRequiredParameters(tool.inputSchema, arguments_);
  for (const name of methodRequired) {
    if (arguments_[name] === undefined) return `Missing required parameter: ${name}`;
  }

  const properties = tool.inputSchema.properties;
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    return undefined;
  }
  const propertySchemas = properties as Record<string, unknown>;
  for (const [name, value] of Object.entries(arguments_)) {
    const schema = propertySchemas[name];
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) continue;
    const type = (schema as {type?: unknown}).type;
    if (type === 'integer' && (!Number.isInteger(value) || typeof value !== 'number')) {
      return `Parameter ${name} must be an integer`;
    }
    if (type === 'array' && !Array.isArray(value)) return `Parameter ${name} must be an array`;
  }
  if (tool.id === 'create_commit') return validateCreateCommitArguments(arguments_);
  return undefined;
}

function validateCreateCommitArguments(arguments_: Record<string, unknown>): string | undefined {
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
    return 'Parameter expected_head_oid must be a 40-character commit oid';
  }
  const message = arguments_.message;
  if (
    !isRecord(message) ||
    typeof message.headline !== 'string' ||
    message.headline.trim().length === 0
  ) {
    return 'Parameter message must be an object with a headline string';
  }
  const additions = arguments_.additions;
  if (additions !== undefined && !isFileAdditionList(additions)) {
    return 'Parameter additions must be an array of {path, contents, encoding?} objects';
  }
  const deletions = arguments_.deletions;
  if (deletions !== undefined && !isFileDeletionList(deletions)) {
    return 'Parameter deletions must be an array of {path} objects';
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
  return value.every((item) => {
    if (!isRecord(item)) return false;
    if (typeof item.path !== 'string' || item.path.length === 0) return false;
    if (typeof item.contents !== 'string') return false;
    return (
      item.encoding === undefined ||
      (typeof item.encoding === 'string' && CREATE_COMMIT_ENCODINGS.has(item.encoding))
    );
  });
}

function isFileDeletionList(value: unknown): value is readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) => isRecord(item) && typeof item.path === 'string' && item.path.length > 0,
  );
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
