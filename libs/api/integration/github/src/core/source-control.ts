import {Buffer} from 'node:buffer';
import {
  asRecord,
  buildProviderRepositoryId,
  type CheckoutSpec,
  type CreateCheckoutSpecInput,
  type FetchFileInput,
  type FilePage,
  type FileSnapshot,
  type IntegrationConnection,
  isRecord,
  isValidGitObjectId,
  isValidTriggerRef,
  type ListFilesInput,
  type ListRepositoriesInput,
  MAX_REPOSITORY_FILE_BYTES,
  nonEmptyString,
  parseProviderRepositoryId,
  positiveInteger,
  type RepositoryPage,
  type RepositorySnapshot,
  type RepositoryVisibility,
  type ResolveRepositoryInput,
  type SourceControlProvider,
  type TriggerReference,
} from '@shipfox/api-integration-spi';
import type {GithubApiClient, GithubRepository} from '#api/client.js';
import {config} from '#config.js';
import {getGithubInstallationByConnectionId} from '#db/installations.js';
import {GithubIntegrationProviderError} from './errors.js';

type GithubIntegrationConnection = IntegrationConnection<'github'>;

const GITHUB_PROVIDER = 'github';
const GITHUB_APP_BOT_SUFFIX = '[bot]';
const SEARCH_PAGE_SIZE = 100;
const SEARCH_MAX_PAGES_PER_REQUEST = 5;

export class GithubSourceControlProvider
  implements SourceControlProvider<GithubIntegrationConnection>
{
  constructor(private readonly github: GithubApiClient) {}

  async listRepositories(
    input: ListRepositoriesInput<GithubIntegrationConnection>,
  ): Promise<RepositoryPage> {
    const installation = await getGithubInstallationByConnectionId(input.connection.id);
    if (!installation) {
      throw new GithubIntegrationProviderError(
        'access-denied',
        'GitHub installation details were not found for the connection',
      );
    }

    const installationId = Number.parseInt(installation.installationId, 10);
    const needle = input.search?.trim().toLowerCase();

    if (!needle) {
      const page = await this.github.listInstallationRepositories({
        installationId,
        limit: input.limit,
        cursor: input.cursor,
      });
      return {
        repositories: page.repositories.map(toRepositorySnapshot),
        nextCursor: page.nextCursor,
      };
    }

    const matches: RepositorySnapshot[] = [];
    let cursor = input.cursor;
    let pagesScanned = 0;
    while (matches.length < input.limit && pagesScanned < SEARCH_MAX_PAGES_PER_REQUEST) {
      const page = await this.github.listInstallationRepositories({
        installationId,
        limit: SEARCH_PAGE_SIZE,
        cursor,
      });
      pagesScanned += 1;
      for (const repo of page.repositories) {
        if (repo.fullName.toLowerCase().includes(needle)) {
          matches.push(toRepositorySnapshot(repo));
        }
      }
      cursor = page.nextCursor ?? undefined;
      if (!cursor) break;
    }

    return {
      repositories: matches.slice(0, input.limit),
      nextCursor: cursor ?? null,
    };
  }

  async resolveRepository(
    input: ResolveRepositoryInput<GithubIntegrationConnection>,
  ): Promise<RepositorySnapshot> {
    const installationId = await this.installationId(input.connection.id);
    const {repositoryId} = parseGithubRepositoryLocator(input.externalRepositoryId);
    const repository = await this.github.getRepository({
      installationId,
      repositoryId,
    });

    return toRepositorySnapshot(repository);
  }

  async listFiles(input: ListFilesInput<GithubIntegrationConnection>): Promise<FilePage> {
    const installationId = await this.installationId(input.connection.id);
    const {repositoryId} = parseGithubRepositoryLocator(input.externalRepositoryId);
    const page = await this.github.listRepositoryFiles({
      installationId,
      repositoryId,
      ref: input.ref,
      prefix: input.prefix,
      limit: input.limit,
      cursor: input.cursor,
    });

    return {
      files: page.files.map((file) => ({path: file.path, type: 'file', size: file.size})),
      nextCursor: page.nextCursor,
    };
  }

  async fetchFile(input: FetchFileInput<GithubIntegrationConnection>): Promise<FileSnapshot> {
    const installationId = await this.installationId(input.connection.id);
    const {repositoryId} = parseGithubRepositoryLocator(input.externalRepositoryId);
    const file = await this.github.fetchRepositoryFile({
      installationId,
      repositoryId,
      ref: input.ref,
      path: input.path,
    });

    if (
      file.size > MAX_REPOSITORY_FILE_BYTES ||
      Buffer.byteLength(file.content, 'utf8') > MAX_REPOSITORY_FILE_BYTES
    ) {
      throw new GithubIntegrationProviderError(
        'content-too-large',
        'GitHub file content is larger than the supported limit',
      );
    }

    return {
      path: file.path,
      ref: input.ref,
      content: file.content,
    };
  }

  resolveTriggerReference(payload: unknown): TriggerReference | null {
    if (!isRecord(payload)) return null;

    const pullRequest = asRecord(payload.pull_request);
    if (pullRequest) {
      const head = asRecord(pullRequest.head);
      const repository = asRecord(head?.repo);
      const base = asRecord(pullRequest.base);
      const baseRepository = asRecord(base?.repo) ?? asRecord(payload.repository);
      if (!repository || !baseRepository || !sameGithubRepository(repository, baseRepository)) {
        return null;
      }
      const repositoryId = githubRepositoryId(repository);
      const number = positiveInteger(pullRequest.number);
      const commit = nonEmptyString(head?.sha);
      const ref = number === null ? null : `refs/pull/${number}/head`;
      if (!repositoryId || !ref || !commit) return null;
      const hasValidReference = isValidGitObjectId(commit) && isValidTriggerRef(ref);
      if (!hasValidReference) return null;
      return {
        externalRepositoryId: buildProviderRepositoryId(GITHUB_PROVIDER, repositoryId),
        ref,
        commit,
      };
    }

    const repositoryId = githubRepositoryId(asRecord(payload.repository));
    const ref = nonEmptyString(payload.ref);
    const commit = nonEmptyString(payload.after);
    if (!repositoryId || !ref || !commit) return null;
    const hasValidReference = isValidGitObjectId(commit) && isValidTriggerRef(ref);
    if (!hasValidReference) return null;
    return {
      externalRepositoryId: buildProviderRepositoryId(GITHUB_PROVIDER, repositoryId),
      ref,
      commit,
    };
  }

  async createCheckoutSpec(
    input: CreateCheckoutSpecInput<GithubIntegrationConnection>,
  ): Promise<CheckoutSpec> {
    const installationId = await this.installationId(input.connection.id);
    const {repositoryId} = parseGithubRepositoryLocator(input.externalRepositoryId);
    const repository = await this.github.getRepository({installationId, repositoryId});
    const ref = input.ref?.trim() || repository.defaultBranch;
    const {token, expiresAt} = await this.github.createInstallationAccessToken({
      installationId,
      repositoryId,
      permissions: input.permissions,
    });
    const gitAuthor = githubAppGitAuthor();

    return {
      repositoryUrl: repository.cloneUrl,
      ref,
      credentials: {username: 'x-access-token', token, expiresAt},
      ...(gitAuthor ? {gitAuthor} : {}),
    };
  }

  private async installationId(connectionId: string): Promise<number> {
    const installation = await getGithubInstallationByConnectionId(connectionId);
    if (!installation) {
      throw new GithubIntegrationProviderError(
        'access-denied',
        'GitHub installation details were not found for the connection',
      );
    }

    return Number.parseInt(installation.installationId, 10);
  }
}

function githubRepositoryId(repository: Record<string, unknown> | null): string | null {
  return positiveInteger(repository?.id) === null ? null : String(repository?.id);
}

function sameGithubRepository(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
): boolean {
  const firstId = githubRepositoryId(first);
  const secondId = githubRepositoryId(second);
  if (firstId && secondId) return firstId === secondId;

  const firstName = nonEmptyString(first.full_name);
  const secondName = nonEmptyString(second.full_name);
  return Boolean(firstName && secondName && firstName.toLowerCase() === secondName.toLowerCase());
}

function githubAppGitAuthor(): CheckoutSpec['gitAuthor'] {
  const appUsername = config.GITHUB_APP_USERNAME?.trim();
  if (!appUsername) return undefined;
  const name = appUsername.endsWith(GITHUB_APP_BOT_SUFFIX)
    ? appUsername
    : `${appUsername}${GITHUB_APP_BOT_SUFFIX}`;
  return {name, email: `${config.GITHUB_APP_ID}+${name}@users.noreply.github.com`};
}

function toRepositorySnapshot(repository: GithubRepository): RepositorySnapshot {
  return {
    externalRepositoryId: buildProviderRepositoryId(GITHUB_PROVIDER, String(repository.id)),
    owner: repository.ownerLogin,
    name: repository.name,
    fullName: repository.fullName,
    defaultBranch: repository.defaultBranch,
    visibility: toRepositoryVisibility(repository),
    cloneUrl: repository.cloneUrl,
    htmlUrl: repository.htmlUrl,
  };
}

function parseGithubRepositoryLocator(externalRepositoryId: string): {
  repositoryId: number;
} {
  const value = parseProviderRepositoryId(externalRepositoryId, GITHUB_PROVIDER);
  const repositoryId = Number.parseInt(value, 10);
  if (!Number.isInteger(repositoryId) || repositoryId <= 0 || String(repositoryId) !== value) {
    throw new GithubIntegrationProviderError(
      'repository-not-found',
      `GitHub repository id ${externalRepositoryId} must follow the form ${GITHUB_PROVIDER}:<numeric-id>`,
    );
  }

  return {repositoryId};
}

function toRepositoryVisibility(repository: GithubRepository): RepositoryVisibility {
  if (repository.visibility === 'public') return 'public';
  if (repository.visibility === 'private') return 'private';
  if (repository.visibility === 'internal') return 'internal';
  return repository.private ? 'private' : 'public';
}
