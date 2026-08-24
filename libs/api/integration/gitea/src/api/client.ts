import {Buffer} from 'node:buffer';
import {MAX_REPOSITORY_FILE_BYTES} from '@shipfox/api-integration-spi';
import {config} from '#config.js';
import {GiteaIntegrationProviderError} from '#core/errors.js';

const TRAILING_SLASHES_RE = /\/+$/;
const NEXT_PAGE_RE = /[?&]page=(\d+)/;

// Recursive tree listing is a single call; a tree larger than this is reported as
// truncated by Gitea and surfaced to the adapter as `too-many-files`.
const TREE_PAGE_SIZE = 1000;

export interface GiteaRepository {
  ownerLogin: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  cloneUrl: string;
  htmlUrl: string;
}

export interface GiteaRepositoryPage {
  repositories: GiteaRepository[];
  nextCursor: string | null;
}

export interface GiteaTreeBlob {
  path: string;
  size: number | null;
}

export interface GiteaTree {
  blobs: GiteaTreeBlob[];
  truncated: boolean;
}

export interface GiteaFileContent {
  path: string;
  content: string;
  size: number;
}

export interface GiteaRefCommit {
  commitSha: string;
}

export interface GiteaIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  state: string;
  comments: number;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface GiteaIssueComment {
  id: number;
  htmlUrl: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface GiteaApiClient {
  listOrgRepositories(input: {
    org: string;
    limit: number;
    cursor?: string | undefined;
  }): Promise<GiteaRepositoryPage>;
  getRepository(input: {owner: string; repo: string}): Promise<GiteaRepository>;
  resolveRef(input: {owner: string; repo: string; ref: string}): Promise<string>;
  getBranch(input: {owner: string; repo: string; branch: string}): Promise<GiteaRefCommit>;
  getTag(input: {owner: string; repo: string; tag: string}): Promise<GiteaRefCommit>;
  listTree(input: {owner: string; repo: string; sha: string}): Promise<GiteaTree>;
  fetchFileContent(input: {
    owner: string;
    repo: string;
    path: string;
    ref: string;
  }): Promise<GiteaFileContent>;
  getIssue(input: {owner: string; repo: string; index: number}): Promise<GiteaIssue>;
  createIssueComment(input: {
    owner: string;
    repo: string;
    index: number;
    body: string;
  }): Promise<GiteaIssueComment>;
  organizationExists(input: {org: string}): Promise<boolean>;
}

export function createGiteaApiClient(): GiteaApiClient {
  return new HttpGiteaApiClient();
}

class HttpGiteaApiClient implements GiteaApiClient {
  private cachedBaseApiUrl: string | undefined;
  private cachedAuthHeader: string | undefined;

  async listOrgRepositories(input: {
    org: string;
    limit: number;
    cursor?: string | undefined;
  }): Promise<GiteaRepositoryPage> {
    const response = await this.request(`orgs/${encodeURIComponent(input.org)}/repos`, {
      page: String(cursorToPage(input.cursor)),
      limit: String(input.limit),
    });
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new GiteaIntegrationProviderError(
        'malformed-provider-response',
        'Gitea repository list response was not an array',
      );
    }

    return {
      repositories: data.map(toGiteaRepository),
      nextCursor: nextCursorFromLink(response.headers.get('link')),
    };
  }

  async getRepository(input: {owner: string; repo: string}): Promise<GiteaRepository> {
    const response = await this.request(
      `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`,
    );
    return toGiteaRepository(await response.json());
  }

  async resolveRef(input: {owner: string; repo: string; ref: string}): Promise<string> {
    const response = await this.request(
      `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/commits`,
      {sha: input.ref, limit: '1', stat: 'false', verification: 'false', files: 'false'},
    );
    const data = await response.json();
    const head = Array.isArray(data) ? data[0] : undefined;
    if (!isRecord(head) || typeof head.sha !== 'string') {
      throw new GiteaIntegrationProviderError(
        'repository-not-found',
        `Gitea ref ${input.ref} did not resolve to a commit`,
      );
    }
    return head.sha;
  }

  async getBranch(input: {owner: string; repo: string; branch: string}): Promise<GiteaRefCommit> {
    const response = await this.request(
      `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/branches/${encodeURIComponent(input.branch)}`,
      {},
      {notFoundReason: 'ref-not-found'},
    );
    const data = await response.json();
    const commit = isRecord(data) ? data.commit : undefined;
    if (!isRecord(commit) || typeof commit.id !== 'string') {
      throw new GiteaIntegrationProviderError(
        'malformed-provider-response',
        `Gitea branch ${input.branch} response is missing the head commit`,
      );
    }
    return {commitSha: commit.id};
  }

  async getTag(input: {owner: string; repo: string; tag: string}): Promise<GiteaRefCommit> {
    const response = await this.request(
      `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/tags/${encodeURIComponent(input.tag)}`,
      {},
      {notFoundReason: 'ref-not-found'},
    );
    const data = await response.json();
    const commit = isRecord(data) ? data.commit : undefined;
    if (!isRecord(commit) || typeof commit.sha !== 'string') {
      throw new GiteaIntegrationProviderError(
        'malformed-provider-response',
        `Gitea tag ${input.tag} response is missing the head commit`,
      );
    }
    return {commitSha: commit.sha};
  }

  async listTree(input: {owner: string; repo: string; sha: string}): Promise<GiteaTree> {
    const response = await this.request(
      `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/trees/${encodeURIComponent(input.sha)}`,
      {recursive: 'true', per_page: String(TREE_PAGE_SIZE)},
    );
    const data = await response.json();
    if (!isRecord(data)) {
      throw new GiteaIntegrationProviderError(
        'malformed-provider-response',
        'Gitea tree response was not an object',
      );
    }

    const entries = Array.isArray(data.tree) ? data.tree : [];
    const blobs: GiteaTreeBlob[] = [];
    for (const entry of entries) {
      if (isRecord(entry) && entry.type === 'blob' && typeof entry.path === 'string') {
        blobs.push({path: entry.path, size: typeof entry.size === 'number' ? entry.size : null});
      }
    }

    return {blobs, truncated: data.truncated === true};
  }

  async fetchFileContent(input: {
    owner: string;
    repo: string;
    path: string;
    ref: string;
  }): Promise<GiteaFileContent> {
    const response = await this.request(
      `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${encodePath(input.path)}`,
      {ref: input.ref},
      {notFoundReason: 'file-not-found'},
    );
    const data = await response.json();

    // Gitea returns an array for a directory path and an object for a single file;
    // a non-file response means the requested path is not a readable file.
    if (!isRecord(data) || Array.isArray(data) || data.type !== 'file') {
      throw new GiteaIntegrationProviderError(
        'file-not-found',
        `Gitea path ${input.path} is not a file`,
      );
    }

    // A well-formed Gitea file response always carries a numeric size; coercing a
    // missing size to 0 would skip the limit guard below and decode unbounded content.
    if (typeof data.size !== 'number') {
      throw new GiteaIntegrationProviderError(
        'malformed-provider-response',
        'Gitea file response did not include a numeric size',
      );
    }
    const size = data.size;
    if (size > MAX_REPOSITORY_FILE_BYTES) {
      throw new GiteaIntegrationProviderError(
        'content-too-large',
        'Gitea file content is larger than the supported limit',
      );
    }
    if (typeof data.content !== 'string' || data.encoding !== 'base64') {
      throw new GiteaIntegrationProviderError(
        'malformed-provider-response',
        'Gitea file response did not include base64 content',
      );
    }

    return {
      path: typeof data.path === 'string' ? data.path : input.path,
      size,
      content: Buffer.from(data.content, 'base64').toString('utf8'),
    };
  }

  async getIssue(input: {owner: string; repo: string; index: number}): Promise<GiteaIssue> {
    const response = await this.request(
      `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.index}`,
      {},
      {notFoundMessage: 'Gitea issue request returned 404'},
    );
    return toGiteaIssue(await response.json());
  }

  async createIssueComment(input: {
    owner: string;
    repo: string;
    index: number;
    body: string;
  }): Promise<GiteaIssueComment> {
    const response = await this.request(
      `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.index}/comments`,
      {},
      {
        method: 'POST',
        body: {body: input.body},
        notFoundMessage: 'Gitea issue comment request returned 404',
      },
    );
    return toGiteaIssueComment(await response.json());
  }

  async organizationExists(input: {org: string}): Promise<boolean> {
    const response = await this.requestRaw(`orgs/${encodeURIComponent(input.org)}`);
    if (response.ok) return true;
    if (response.status === 404) return false;
    throw await giteaHttpError(response);
  }

  private async request(
    path: string,
    searchParams: Record<string, string> = {},
    options: {
      notFoundReason?: NotFoundReason;
      notFoundMessage?: string;
      method?: string;
      body?: unknown;
    } = {},
  ): Promise<Response> {
    const response = await this.requestRaw(path, {
      searchParams,
      ...(options.method === undefined ? {} : {method: options.method}),
      ...(options.body === undefined ? {} : {body: options.body}),
    });
    if (!response.ok)
      throw await giteaHttpError(
        response,
        options.notFoundReason ?? 'repository-not-found',
        options.notFoundMessage,
      );
    return response;
  }

  private async requestRaw(
    path: string,
    options: {method?: string; searchParams?: Record<string, string>; body?: unknown} = {},
  ): Promise<Response> {
    const url = new URL(`${this.baseApiUrl()}/${path}`);
    for (const [key, value] of Object.entries(options.searchParams ?? {})) {
      url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      authorization: this.authHeader(),
      accept: 'application/json',
    };
    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      signal: AbortSignal.timeout(config.GITEA_REQUEST_TIMEOUT_MS),
    };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    try {
      return await fetch(url, init);
    } catch (error) {
      // A bare `fetch` has no request timeout, so an unresponsive Gitea would
      // otherwise hold the worker open indefinitely; the AbortSignal.timeout
      // above surfaces as a fast `timeout` (503) instead of stalling.
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new GiteaIntegrationProviderError('timeout', 'Gitea request timed out');
      }
      throw new GiteaIntegrationProviderError(
        'provider-unavailable',
        `Gitea request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private baseApiUrl(): string {
    if (!this.cachedBaseApiUrl) {
      this.cachedBaseApiUrl = `${config.GITEA_BASE_URL.replace(TRAILING_SLASHES_RE, '')}/api/v1`;
    }
    return this.cachedBaseApiUrl;
  }

  private authHeader(): string {
    if (!this.cachedAuthHeader) {
      const credentials = `${config.GITEA_SERVICE_USERNAME}:${config.GITEA_SERVICE_TOKEN}`;
      this.cachedAuthHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;
    }
    return this.cachedAuthHeader;
  }
}

type NotFoundReason = 'repository-not-found' | 'file-not-found' | 'ref-not-found';
const MAX_PROVIDER_ERROR_BODY_BYTES = 8 * 1024;
const MAX_PROVIDER_ERROR_MESSAGE_LENGTH = 500;

async function giteaHttpError(
  response: Response,
  notFoundReason: NotFoundReason = 'repository-not-found',
  notFoundMessage?: string,
): Promise<GiteaIntegrationProviderError> {
  const status = response.status;
  const fallback =
    status === 404 && notFoundMessage ? notFoundMessage : `Gitea responded ${status}`;
  const message =
    status >= 400 && status < 500 ? await giteaResponseErrorMessage(response, fallback) : fallback;
  if (status === 404) {
    return new GiteaIntegrationProviderError(notFoundReason, message, undefined, status);
  }
  if (isRateLimited(response)) {
    return new GiteaIntegrationProviderError(
      'rate-limited',
      message,
      retryAfterSeconds(response),
      status,
    );
  }
  if (status === 401 || status === 403) {
    return new GiteaIntegrationProviderError('access-denied', message, undefined, status);
  }
  if (status >= 400 && status < 500) {
    return new GiteaIntegrationProviderError('provider-rejected', message, undefined, status);
  }
  // Server errors and any other unexpected status mean the provider could not
  // serve the request; surface it as unavailable rather than leaking a raw error.
  return new GiteaIntegrationProviderError('provider-unavailable', message, undefined, status);
}

async function giteaResponseErrorMessage(response: Response, fallback: string): Promise<string> {
  let body: string;
  try {
    body = await readBoundedResponseText(response);
  } catch {
    return fallback;
  }

  const trimmedBody = body.trim();
  if (!trimmedBody) return fallback;

  try {
    const parsed: unknown = JSON.parse(trimmedBody);
    if (isRecord(parsed)) {
      const providerMessage =
        typeof parsed.message === 'string'
          ? parsed.message
          : typeof parsed.error === 'string'
            ? parsed.error
            : undefined;
      if (providerMessage?.trim()) return `${fallback}: ${truncate(providerMessage)}`;
    }
  } catch {
    // Fall through to the bounded raw response text below.
  }

  return `${fallback}: ${truncate(trimmedBody)}`;
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const body = response.clone().body;
  if (!body) return '';

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (byteLength < MAX_PROVIDER_ERROR_BODY_BYTES) {
      const {done, value} = await reader.read();
      if (done || !value || value.byteLength === 0) break;

      const remaining = MAX_PROVIDER_ERROR_BODY_BYTES - byteLength;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        byteLength += remaining;
        await reader.cancel();
        break;
      }

      chunks.push(value);
      byteLength += value.byteLength;
      if (byteLength >= MAX_PROVIDER_ERROR_BODY_BYTES) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function truncate(value: string): string {
  const codePoints = [...value];
  return codePoints.length > MAX_PROVIDER_ERROR_MESSAGE_LENGTH
    ? `${codePoints.slice(0, MAX_PROVIDER_ERROR_MESSAGE_LENGTH - 3).join('')}...`
    : value;
}

function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  return response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0';
}

function retryAfterSeconds(response: Response): number | undefined {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return undefined;
  const parsed = Number.parseInt(retryAfter, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function cursorToPage(cursor: string | undefined): number {
  if (!cursor) return 1;
  const page = Number.parseInt(cursor, 10);
  return Number.isNaN(page) || page < 1 ? 1 : page;
}

function nextCursorFromLink(link: string | null): string | null {
  if (!link) return null;
  const next = link.split(',').find((part) => part.includes('rel="next"'));
  if (!next) return null;
  const match = next.match(NEXT_PAGE_RE);
  return match?.[1] ?? null;
}

function encodePath(path: string): string {
  const segments = path.split('/');
  // `..`/`.`/empty segments survive encodeURIComponent and would let `new URL`
  // normalize the request path out of `/contents/` and hit other authenticated
  // Gitea endpoints, so reject them before building the URL.
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new GiteaIntegrationProviderError(
        'file-not-found',
        `Gitea path contains an invalid segment: ${path}`,
      );
    }
  }
  return segments.map(encodeURIComponent).join('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toGiteaIssue(raw: unknown): GiteaIssue {
  if (
    !isRecord(raw) ||
    typeof raw.id !== 'number' ||
    typeof raw.number !== 'number' ||
    typeof raw.title !== 'string' ||
    typeof raw.body !== 'string' ||
    typeof raw.state !== 'string' ||
    typeof raw.comments !== 'number' ||
    typeof raw.html_url !== 'string' ||
    typeof raw.created_at !== 'string' ||
    typeof raw.updated_at !== 'string'
  ) {
    throw new GiteaIntegrationProviderError(
      'malformed-provider-response',
      'Gitea issue response is missing required fields',
    );
  }

  return {
    id: raw.id,
    number: raw.number,
    title: raw.title,
    body: raw.body,
    state: raw.state,
    comments: raw.comments,
    htmlUrl: raw.html_url,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function toGiteaIssueComment(raw: unknown): GiteaIssueComment {
  if (
    !isRecord(raw) ||
    typeof raw.id !== 'number' ||
    typeof raw.html_url !== 'string' ||
    typeof raw.body !== 'string' ||
    typeof raw.created_at !== 'string' ||
    typeof raw.updated_at !== 'string'
  ) {
    throw new GiteaIntegrationProviderError(
      'malformed-provider-response',
      'Gitea issue comment response is missing required fields',
    );
  }

  return {
    id: raw.id,
    htmlUrl: raw.html_url,
    body: raw.body,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function toGiteaRepository(raw: unknown): GiteaRepository {
  if (
    !isRecord(raw) ||
    !isRecord(raw.owner) ||
    typeof raw.owner.login !== 'string' ||
    typeof raw.name !== 'string' ||
    typeof raw.full_name !== 'string' ||
    typeof raw.default_branch !== 'string' ||
    typeof raw.clone_url !== 'string' ||
    typeof raw.html_url !== 'string'
  ) {
    throw new GiteaIntegrationProviderError(
      'malformed-provider-response',
      'Gitea repository response is missing required fields',
    );
  }

  return {
    ownerLogin: raw.owner.login,
    name: raw.name,
    fullName: raw.full_name,
    defaultBranch: raw.default_branch,
    private: raw.private === true,
    cloneUrl: raw.clone_url,
    htmlUrl: raw.html_url,
  };
}
