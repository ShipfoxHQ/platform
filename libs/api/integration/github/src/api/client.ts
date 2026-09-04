import {Buffer} from 'node:buffer';
import {isRecord, MAX_REPOSITORY_FILE_BYTES} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError, TimeoutError} from 'ky';
import {App, Octokit, RequestError} from 'octokit';
import {config, normalizedGithubApiBaseUrl, normalizedGithubPrivateKey} from '#config.js';
import {GithubIntegrationProviderError} from '#core/errors.js';
import {recordInstallationTokenFormat} from '#metrics/index.js';
import {
  getGithubInstallationOctokit,
  githubInstallationTokenFormatPlugin,
} from './github-octokit.js';

const NEXT_PAGE_RE = /[?&]page=(\d+)/;
const TRAILING_SLASHES_RE = /\/+$/;
const MAX_TREE_WALK_DEPTH = 10;
const GITHUB_API_TIMEOUT_MS = 10_000;

export interface GithubAccount {
  login: string;
  type: string;
}

export interface GithubInstallationDetails {
  id: number;
  account: GithubAccount;
  repositorySelection: string;
  suspendedAt: Date | null;
  htmlUrl: string;
  raw: Record<string, unknown>;
}

export interface GithubRepository {
  id: number;
  ownerLogin: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  visibility?: string | undefined;
  cloneUrl: string;
  htmlUrl: string;
}

export interface GithubRepositoryPage {
  repositories: GithubRepository[];
  nextCursor: string | null;
}

export interface GithubFileEntry {
  path: string;
  size: number | null;
}

export interface GithubFilePage {
  files: GithubFileEntry[];
  nextCursor: string | null;
}

export interface GithubFileContent {
  path: string;
  content: string;
  size: number;
}

export interface GithubCommit {
  sha: string;
}

export interface GithubUserInstallationPage {
  installationIds: number[];
  nextCursor: string | null;
}

export interface GithubBotUser {
  id: number;
  login: string;
}

export interface GithubBotUserClient {
  getBotUser(input: {username: string; installationAccessToken: string}): Promise<GithubBotUser>;
}

export interface GithubApiClient extends Partial<GithubBotUserClient> {
  exchangeOAuthCode(code: string): Promise<string>;
  listUserInstallations(input: {
    userAccessToken: string;
    cursor?: string | undefined;
  }): Promise<GithubUserInstallationPage>;
  getInstallation(installationId: number): Promise<GithubInstallationDetails>;
  listInstallationRepositories(input: {
    installationId: number;
    limit: number;
    cursor?: string | undefined;
  }): Promise<GithubRepositoryPage>;
  getRepository(input: {installationId: number; repositoryId: number}): Promise<GithubRepository>;
  listRepositoryFiles(input: {
    installationId: number;
    repositoryId: number;
    ref: string;
    prefix: string;
    limit: number;
    cursor?: string | undefined;
  }): Promise<GithubFilePage>;
  fetchRepositoryFile(input: {
    installationId: number;
    repositoryId: number;
    ref: string;
    path: string;
  }): Promise<GithubFileContent>;
  listRepositoryCommits(input: {
    installationId: number;
    repositoryId: number;
    ref: string;
  }): Promise<GithubCommit[]>;
  createInstallationAccessToken(
    input: GithubInstallationAccessTokenInput,
  ): Promise<GithubInstallationAccessToken>;
}

export type GithubInstallationAccessTokenInput = {
  installationId: number;
  permissions?: {contents: 'read' | 'write'} | undefined;
} & (
  | {repositoryId: number; repositoryName?: never}
  | {repositoryName: string; repositoryId?: never}
);

export interface GithubInstallationAccessToken {
  token: string;
  expiresAt: Date;
  permissions?: Record<string, 'read' | 'write' | 'admin'> | undefined;
  /** GitHub returns the repositories granted to a repository-scoped token. */
  repositories?: GithubRepository[] | undefined;
  /** Numeric repository ids retained for exact-scope checkout-cache validation. */
  repositoryIds?: number[] | undefined;
}

export function createGithubApiClient(): GithubApiClient & GithubBotUserClient {
  return new OctokitGithubApiClient();
}

class OctokitGithubApiClient implements GithubApiClient, GithubBotUserClient {
  private app: App | undefined;
  private readonly botUsers = new Map<string, GithubBotUser>();
  private readonly botUserLookups = new Map<
    string,
    {installationAccessToken: string; promise: Promise<GithubBotUser>}
  >();

  async exchangeOAuthCode(code: string): Promise<string> {
    const body = await mapGithubOAuthError(() =>
      ky
        .post('https://github.com/login/oauth/access_token', {
          headers: {accept: 'application/json'},
          json: {
            client_id: config.GITHUB_APP_CLIENT_ID,
            client_secret: config.GITHUB_APP_CLIENT_SECRET,
            code,
          },
        })
        .json<{access_token?: unknown}>(),
    );

    if (typeof body.access_token !== 'string') {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub OAuth response did not include an access token',
      );
    }
    return body.access_token;
  }

  getBotUser(input: {username: string; installationAccessToken: string}): Promise<GithubBotUser> {
    const cacheKey = input.username.trim().toLowerCase();
    const cached = this.botUsers.get(cacheKey);
    if (cached) return Promise.resolve(cached);

    const pending = this.botUserLookups.get(cacheKey);
    if (pending?.installationAccessToken === input.installationAccessToken) {
      return pending.promise;
    }

    const lookup = this.fetchBotUser(input).then((botUser) => {
      const resolved = this.botUsers.get(cacheKey);
      if (resolved) return resolved;

      this.botUsers.set(cacheKey, botUser);
      logger().info(
        {githubAppBotLogin: botUser.login, githubAppBotUserId: botUser.id},
        'Resolved GitHub App bot identity',
      );
      return botUser;
    });
    const trackedLookup = lookup.finally(() => {
      if (this.botUserLookups.get(cacheKey)?.promise === trackedLookup) {
        this.botUserLookups.delete(cacheKey);
      }
    });
    this.botUserLookups.set(cacheKey, {
      installationAccessToken: input.installationAccessToken,
      promise: trackedLookup,
    });
    return trackedLookup;
  }

  async listUserInstallations(input: {
    userAccessToken: string;
    cursor?: string | undefined;
  }): Promise<GithubUserInstallationPage> {
    const octokit = new Octokit({
      auth: input.userAccessToken,
      baseUrl: normalizedGithubApiBaseUrl(),
    });
    const page = cursorToPage(input.cursor);
    const response = await mapGithubError(() =>
      octokit.request('GET /user/installations', {
        per_page: 100,
        page,
      }),
    );

    const installations = response.data.installations ?? [];
    return {
      installationIds: installations.map((installation) => installation.id),
      nextCursor: nextCursorFromLink(response.headers.link),
    };
  }

  async getInstallation(installationId: number): Promise<GithubInstallationDetails> {
    const response = await mapGithubError(() =>
      this.getApp().octokit.rest.apps.getInstallation({installation_id: installationId}),
    );
    const data = response.data;
    const account = data.account;
    if (!account) {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub installation response did not include an account',
      );
    }

    const login = 'login' in account ? account.login : account.slug;
    return {
      id: data.id,
      account: {
        login,
        type: 'type' in account ? account.type : 'Enterprise',
      },
      repositorySelection: data.repository_selection,
      suspendedAt: data.suspended_at ? new Date(data.suspended_at) : null,
      htmlUrl: data.html_url,
      raw: data as unknown as Record<string, unknown>,
    };
  }

  async listInstallationRepositories(input: {
    installationId: number;
    limit: number;
    cursor?: string | undefined;
  }): Promise<GithubRepositoryPage> {
    const octokit = await mapGithubError(() =>
      getGithubInstallationOctokit(this.getApp(), input.installationId),
    );
    const page = cursorToPage(input.cursor);
    const response = await mapGithubError(() =>
      octokit.rest.apps.listReposAccessibleToInstallation({
        per_page: input.limit,
        page,
      }),
    );

    return {
      repositories: response.data.repositories.map(toGithubRepository),
      nextCursor: nextCursorFromLink(response.headers.link),
    };
  }

  async getRepository(input: {
    installationId: number;
    repositoryId: number;
  }): Promise<GithubRepository> {
    const octokit = await mapGithubError(() =>
      getGithubInstallationOctokit(this.getApp(), input.installationId),
    );
    const response = await mapGithubError(() =>
      octokit.request('GET /repositories/{repository_id}', {
        repository_id: input.repositoryId,
        request: {signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS)},
      }),
    );

    return toGithubRepository(response.data);
  }

  async listRepositoryFiles(input: {
    installationId: number;
    repositoryId: number;
    ref: string;
    prefix: string;
    limit: number;
    cursor?: string | undefined;
  }): Promise<GithubFilePage> {
    const octokit = await mapGithubError(() =>
      getGithubInstallationOctokit(this.getApp(), input.installationId),
    );
    const repository = await this.getRepository({
      installationId: input.installationId,
      repositoryId: input.repositoryId,
    });
    const owner = repository.ownerLogin;
    const repo = repository.name;
    const startPath = input.prefix.replace(TRAILING_SLASHES_RE, '');
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    const start = Number.isNaN(offset) || offset < 0 ? 0 : offset;
    const collected: GithubFileEntry[] = [];
    const overflowLimit = start + input.limit + 1;

    type GetContentData = Awaited<ReturnType<typeof octokit.rest.repos.getContent>>['data'];
    type GetContentEntry = Extract<GetContentData, unknown[]>[number];

    const fetchContent = async (path: string): Promise<GetContentData | undefined> => {
      try {
        const response = await mapGithubError(
          () => octokit.rest.repos.getContent({owner, repo, path, ref: input.ref}),
          'file-not-found',
        );
        return response.data;
      } catch (error) {
        if (error instanceof GithubIntegrationProviderError && error.reason === 'file-not-found') {
          return undefined;
        }
        throw error;
      }
    };

    const collectFile = (data: {path?: string; size?: number; type: string}): void => {
      if (data.type !== 'file' || !data.path) return;
      collected.push({path: data.path, size: typeof data.size === 'number' ? data.size : null});
    };

    const walk = async (path: string, depth: number): Promise<void> => {
      if (collected.length >= overflowLimit) return;
      if (depth > MAX_TREE_WALK_DEPTH) return;
      const data = await fetchContent(path);
      if (data === undefined) return;
      if (!Array.isArray(data)) {
        collectFile(data);
        return;
      }
      const entries = [...data].sort((a, b) => (a.path ?? '').localeCompare(b.path ?? ''));
      for (const entry of entries) {
        if (!(await collectGithubEntry(entry, depth))) return;
      }
    };

    const collectGithubEntry = async (entry: GetContentEntry, depth: number): Promise<boolean> => {
      if (collected.length >= overflowLimit) return false;
      if (!entry.path) return true;
      if (entry.type === 'file') collectFile(entry);
      else if (entry.type === 'dir') await walk(entry.path, depth + 1);
      return true;
    };

    await walk(startPath, 0);

    const sorted = collected.sort((a, b) => a.path.localeCompare(b.path));
    const page = sorted.slice(start, start + input.limit);
    const consumed = start + page.length;
    const hasMore = consumed < sorted.length;

    return {
      files: page,
      nextCursor: hasMore ? String(consumed) : null,
    };
  }

  async fetchRepositoryFile(input: {
    installationId: number;
    repositoryId: number;
    ref: string;
    path: string;
  }): Promise<GithubFileContent> {
    const octokit = await mapGithubError(() =>
      getGithubInstallationOctokit(this.getApp(), input.installationId),
    );
    const repository = await this.getRepository({
      installationId: input.installationId,
      repositoryId: input.repositoryId,
    });
    const response = await mapGithubError(
      () =>
        octokit.rest.repos.getContent({
          owner: repository.ownerLogin,
          repo: repository.name,
          path: input.path,
          ref: input.ref,
        }),
      'file-not-found',
    );
    const data = response.data;

    if (Array.isArray(data) || data.type !== 'file') {
      throw new GithubIntegrationProviderError('file-not-found', 'GitHub path is not a file');
    }
    if (data.size > MAX_REPOSITORY_FILE_BYTES) {
      throw new GithubIntegrationProviderError(
        'content-too-large',
        'GitHub file content is larger than the supported limit',
      );
    }
    if (typeof data.content !== 'string' || data.encoding !== 'base64') {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub file response did not include base64 content',
      );
    }

    return {
      path: data.path,
      size: data.size,
      content: Buffer.from(data.content, 'base64').toString('utf8'),
    };
  }

  async listRepositoryCommits(input: {
    installationId: number;
    repositoryId: number;
    ref: string;
  }): Promise<GithubCommit[]> {
    const octokit = await mapGithubError(() =>
      getGithubInstallationOctokit(this.getApp(), input.installationId),
    );
    const repository = await this.getRepository({
      installationId: input.installationId,
      repositoryId: input.repositoryId,
    });
    const response = await mapGithubError(
      () =>
        octokit.rest.repos.listCommits({
          owner: repository.ownerLogin,
          repo: repository.name,
          sha: input.ref,
          per_page: 1,
          request: {signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS)},
        }),
      'ref-not-found',
    );
    return response.data.map((commit) => {
      if (typeof commit.sha !== 'string') {
        throw new GithubIntegrationProviderError(
          'malformed-provider-response',
          'GitHub commit response is missing the commit sha',
        );
      }
      return {sha: commit.sha};
    });
  }

  async createInstallationAccessToken(
    input: GithubInstallationAccessTokenInput,
  ): Promise<GithubInstallationAccessToken> {
    let repositorySelector: {repositories: string[]} | {repository_ids: number[]};
    if (input.repositoryName !== undefined) {
      repositorySelector = {repositories: [input.repositoryName]};
    } else if (input.repositoryId !== undefined) {
      repositorySelector = {repository_ids: [input.repositoryId]};
    } else {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub installation access token request did not include a repository',
      );
    }
    const response = await mapGithubError(() =>
      this.getApp().octokit.rest.apps.createInstallationAccessToken({
        installation_id: input.installationId,
        ...repositorySelector,
        permissions: input.permissions ?? {contents: 'read'},
      }),
    );

    if (typeof response.data.token !== 'string') {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub installation access token response did not include a token',
      );
    }

    recordInstallationTokenFormat(response.data.token);

    const expiresAt = new Date(response.data.expires_at);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub installation access token response did not include a valid expiry',
      );
    }

    const repositories = Array.isArray(response.data.repositories)
      ? response.data.repositories.map(toGithubRepository)
      : undefined;
    const repositoryIds = repositories?.map(({id}) => id);

    return {
      token: response.data.token,
      expiresAt,
      ...(response.data.permissions === undefined ? {} : {permissions: response.data.permissions}),
      ...(repositories === undefined ? {} : {repositories}),
      ...(repositoryIds === undefined ? {} : {repositoryIds}),
    };
  }

  private getApp(): App {
    if (!this.app) {
      this.app = new App({
        appId: config.GITHUB_APP_ID,
        privateKey: normalizedGithubPrivateKey(),
        Octokit: Octokit.plugin(githubInstallationTokenFormatPlugin).defaults({
          baseUrl: normalizedGithubApiBaseUrl(),
        }),
      });
    }
    return this.app;
  }

  private async fetchBotUser(input: {
    username: string;
    installationAccessToken: string;
  }): Promise<GithubBotUser> {
    const octokit = new Octokit({
      auth: input.installationAccessToken,
      baseUrl: normalizedGithubApiBaseUrl(),
    });
    let response: Awaited<ReturnType<typeof octokit.rest.users.getByUsername>>;
    try {
      response = await mapGithubError(
        () =>
          octokit.rest.users.getByUsername({
            username: input.username,
            request: {signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS)},
          }),
        'provider-rejected',
      );
    } catch (error) {
      if (error instanceof GithubIntegrationProviderError && error.status === 404) {
        throw new GithubIntegrationProviderError(
          'provider-rejected',
          `Configured GitHub bot user ${input.username} was not found`,
          undefined,
          error.status,
        );
      }
      throw error;
    }

    const data: unknown = response.data;
    if (!isRecord(data)) {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub bot user response is missing required fields',
      );
    }
    const {id, login, type} = data;
    if (
      typeof id !== 'number' ||
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      typeof login !== 'string' ||
      login.trim().length === 0
    ) {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub bot user response is missing required fields',
      );
    }
    if (type !== 'Bot') {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'Configured GitHub username is not a bot account',
      );
    }
    const canonicalLogin = login.trim();
    if (canonicalLogin.toLowerCase() !== input.username.trim().toLowerCase()) {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub bot user response did not match the configured username',
      );
    }
    return {id, login: canonicalLogin};
  }
}

async function mapGithubOAuthError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof HTTPError) {
      if (error.response.status === 429) {
        throw new GithubIntegrationProviderError(
          'rate-limited',
          'GitHub OAuth code exchange failed',
          retryAfterSecondsFromHeaders(error.response.headers),
        );
      }
      if (error.response.status >= 500) {
        throw new GithubIntegrationProviderError(
          'provider-unavailable',
          'GitHub OAuth code exchange failed',
        );
      }
      throw new GithubIntegrationProviderError(
        'access-denied',
        'GitHub OAuth code exchange failed',
      );
    }
    if (error instanceof TimeoutError) {
      throw new GithubIntegrationProviderError('timeout', 'GitHub OAuth request timed out');
    }
    throw error;
  }
}

export async function mapGithubError<T>(
  operation: () => Promise<T>,
  notFoundReason:
    | 'repository-not-found'
    | 'installation-not-found'
    | 'file-not-found'
    | 'ref-not-found'
    | 'provider-rejected' = 'repository-not-found',
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof GithubIntegrationProviderError) throw error;
    if (isGithubTimeoutError(error)) {
      throw new GithubIntegrationProviderError('timeout', 'GitHub request timed out');
    }
    if (error instanceof RequestError) throw mapGithubRequestError(error, notFoundReason);
    throw error;
  }
}

function mapGithubRequestError(
  error: RequestError,
  notFoundReason:
    | 'repository-not-found'
    | 'installation-not-found'
    | 'file-not-found'
    | 'ref-not-found'
    | 'provider-rejected',
): GithubIntegrationProviderError {
  let reason: ConstructorParameters<typeof GithubIntegrationProviderError>[0];
  let retryAfter: number | undefined;
  if (error.status === 404) {
    reason = notFoundReason === 'ref-not-found' ? 'repository-not-found' : notFoundReason;
  } else if (notFoundReason === 'ref-not-found' && (error.status === 409 || error.status === 422)) {
    reason = 'ref-not-found';
  } else if (error.status === 429 || isGithubRateLimitError(error)) {
    reason = 'rate-limited';
    retryAfter = retryAfterSeconds(error);
  } else if (error.status === 401 || error.status === 403) {
    reason = 'access-denied';
    retryAfter = retryAfterSeconds(error);
  } else if (error.status >= 500) {
    reason = 'provider-unavailable';
  } else if (error.status >= 400) {
    reason = 'provider-rejected';
  } else throw error;
  const message = reason === 'access-denied' ? withAcceptedPermissions(error) : error.message;
  return new GithubIntegrationProviderError(reason, message, retryAfter, error.status);
}

// GitHub names the grants that would have satisfied a denied request in this header. It is
// the only way to tell a missing permission apart from a resource the token cannot see.
function withAcceptedPermissions(error: RequestError): string {
  const accepted = error.response?.headers['x-accepted-github-permissions'];
  if (typeof accepted !== 'string' || accepted.length === 0) return error.message;
  return `${error.message} (GitHub accepts permissions: ${accepted})`;
}

function isGithubTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  return error.cause instanceof Error && isGithubTimeoutError(error.cause);
}

function isGithubRateLimitError(error: RequestError): boolean {
  return error.status === 403 && error.response?.headers['x-ratelimit-remaining'] === '0';
}

function retryAfterSeconds(error: RequestError): number | undefined {
  return parseRetryAfterSeconds(error.response?.headers['retry-after']);
}

function retryAfterSecondsFromHeaders(headers: Headers): number | undefined {
  return parseRetryAfterSeconds(headers.get('retry-after'));
}

function parseRetryAfterSeconds(
  retryAfter: string | number | null | undefined,
): number | undefined {
  if (!retryAfter) return undefined;
  const parsed = Number.parseInt(String(retryAfter), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function cursorToPage(cursor: string | undefined): number {
  if (!cursor) return 1;
  const page = Number.parseInt(cursor, 10);
  return Number.isNaN(page) || page < 1 ? 1 : page;
}

function nextCursorFromLink(link: string | undefined): string | null {
  if (!link) return null;
  const next = link.split(',').find((part) => part.includes('rel="next"'));
  if (!next) return null;
  const match = next.match(NEXT_PAGE_RE);
  return match?.[1] ?? null;
}

function toGithubRepository(repository: {
  id: number;
  owner: {login: string};
  name: string;
  full_name: string;
  default_branch?: string | null | undefined;
  private: boolean;
  visibility?: string | null | undefined;
  clone_url?: string | null | undefined;
  html_url?: string | null | undefined;
}): GithubRepository {
  const ownerLogin = repository.owner?.login;
  if (
    !Number.isSafeInteger(repository.id) ||
    repository.id <= 0 ||
    !nonEmptyGithubField(ownerLogin) ||
    !nonEmptyGithubField(repository.name) ||
    !nonEmptyGithubField(repository.full_name) ||
    typeof repository.private !== 'boolean' ||
    (repository.visibility !== undefined &&
      repository.visibility !== null &&
      typeof repository.visibility !== 'string') ||
    !nonEmptyGithubField(repository.default_branch) ||
    !nonEmptyGithubField(repository.clone_url) ||
    !nonEmptyGithubField(repository.html_url)
  ) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub repository response is missing required fields',
    );
  }
  return {
    id: repository.id,
    ownerLogin,
    name: repository.name,
    fullName: repository.full_name,
    defaultBranch: repository.default_branch,
    private: repository.private,
    visibility: repository.visibility ?? undefined,
    cloneUrl: repository.clone_url,
    htmlUrl: repository.html_url,
  };
}

function nonEmptyGithubField(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
