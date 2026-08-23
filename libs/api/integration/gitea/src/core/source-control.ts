import {Buffer} from 'node:buffer';
import {giteaProviderKind} from '@shipfox/api-integration-gitea-dto';
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
  isValidResolvableRef,
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
  type ResolvedRef,
  type ResolveRefInput,
  type ResolveRepositoryInput,
  type SourceControlProvider,
  type TriggerReference,
} from '@shipfox/api-integration-spi';
import type {GiteaApiClient, GiteaRepository} from '#api/client.js';
import {config, giteaCloneBaseOrigin} from '#config.js';
import {GiteaIntegrationProviderError} from './errors.js';

type GiteaIntegrationConnection = IntegrationConnection<'gitea'>;

const TRAILING_SLASHES_RE = /\/+$/;
const REFS_HEADS_PREFIX = 'refs/heads/';
const REFS_TAGS_PREFIX = 'refs/tags/';
const SEARCH_PAGE_SIZE = 100;
const SEARCH_MAX_PAGES_PER_REQUEST = 5;

export class GiteaSourceControlProvider
  implements SourceControlProvider<GiteaIntegrationConnection>
{
  constructor(private readonly gitea: GiteaApiClient) {}

  async listRepositories(
    input: ListRepositoriesInput<GiteaIntegrationConnection>,
  ): Promise<RepositoryPage> {
    const org = input.connection.externalAccountId;
    const needle = input.search?.trim().toLowerCase();

    if (!needle) {
      const page = await this.gitea.listOrgRepositories({
        org,
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
      const page = await this.gitea.listOrgRepositories({org, limit: SEARCH_PAGE_SIZE, cursor});
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
    input: ResolveRepositoryInput<GiteaIntegrationConnection>,
  ): Promise<RepositorySnapshot> {
    const {owner, repo} = parseGiteaRepositoryLocator(
      input.externalRepositoryId,
      input.connection.externalAccountId,
    );
    return toRepositorySnapshot(await this.gitea.getRepository({owner, repo}));
  }

  async listFiles(input: ListFilesInput<GiteaIntegrationConnection>): Promise<FilePage> {
    const {owner, repo} = parseGiteaRepositoryLocator(
      input.externalRepositoryId,
      input.connection.externalAccountId,
    );
    const sha = await this.gitea.resolveRef({owner, repo, ref: input.ref});
    const tree = await this.gitea.listTree({owner, repo, sha});
    if (tree.truncated) {
      throw new GiteaIntegrationProviderError(
        'too-many-files',
        `Gitea repository tree for ${input.externalRepositoryId} is too large to enumerate`,
      );
    }

    const prefix = input.prefix.replace(TRAILING_SLASHES_RE, '');
    const matched = tree.blobs
      .filter((blob) => prefixMatches(blob.path, prefix))
      .sort((a, b) => a.path.localeCompare(b.path));
    const offset = parseOffset(input.cursor);
    const page = matched.slice(offset, offset + input.limit);
    const consumed = offset + page.length;

    return {
      files: page.map((blob) => ({path: blob.path, type: 'file', size: blob.size})),
      nextCursor: consumed < matched.length ? String(consumed) : null,
    };
  }

  async fetchFile(input: FetchFileInput<GiteaIntegrationConnection>): Promise<FileSnapshot> {
    const {owner, repo} = parseGiteaRepositoryLocator(
      input.externalRepositoryId,
      input.connection.externalAccountId,
    );
    const file = await this.gitea.fetchFileContent({owner, repo, path: input.path, ref: input.ref});

    if (
      file.size > MAX_REPOSITORY_FILE_BYTES ||
      Buffer.byteLength(file.content, 'utf8') > MAX_REPOSITORY_FILE_BYTES
    ) {
      throw new GiteaIntegrationProviderError(
        'content-too-large',
        'Gitea file content is larger than the supported limit',
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

    const actor = giteaEventActor(payload);
    const pullRequest = asRecord(payload.pull_request);
    if (pullRequest) {
      const head = asRecord(pullRequest.head);
      const repository = asRecord(head?.repo);
      const base = asRecord(pullRequest.base);
      const baseRepository = asRecord(base?.repo) ?? asRecord(payload.repository);
      if (!repository || !baseRepository || !sameGiteaRepository(repository, baseRepository)) {
        return null;
      }
      const repositoryId = giteaRepositoryId(repository);
      const number = positiveInteger(pullRequest.number);
      const commit = nonEmptyString(head?.sha);
      const ref = number === null ? null : `refs/pull/${number}/head`;
      if (!repositoryId || !ref || !commit) return null;
      const hasValidReference = isValidGitObjectId(commit) && isValidTriggerRef(ref);
      if (!hasValidReference) return null;
      return {
        externalRepositoryId: buildProviderRepositoryId(giteaProviderKind, repositoryId),
        ref,
        commit,
        actor,
      };
    }

    const repositoryId = giteaRepositoryId(asRecord(payload.repository));
    const ref = nonEmptyString(payload.ref);
    const commit = nonEmptyString(payload.after);
    if (!repositoryId || !ref || !commit) return null;
    const hasValidReference = isValidGitObjectId(commit) && isValidTriggerRef(ref);
    if (!hasValidReference) return null;
    return {
      externalRepositoryId: buildProviderRepositoryId(giteaProviderKind, repositoryId),
      ref,
      commit,
      actor,
    };
  }

  async resolveRef(input: ResolveRefInput<GiteaIntegrationConnection>): Promise<ResolvedRef> {
    if (!isValidResolvableRef(input.ref)) {
      throw new GiteaIntegrationProviderError(
        'ref-invalid',
        `Gitea ref ${formatRefForMessage(input.ref)} is not a resolvable branch or tag name`,
      );
    }
    const {owner, repo} = parseGiteaRepositoryLocator(
      input.externalRepositoryId,
      input.connection.externalAccountId,
    );

    const providerRef = providerRefName(input.ref);
    const branchLookup = () => this.gitea.getBranch({owner, repo, branch: providerRef});
    const tagLookup = () => this.gitea.getTag({owner, repo, tag: providerRef});
    const lookups: Array<() => Promise<{commitSha: string}>> = input.ref.startsWith(
      REFS_TAGS_PREFIX,
    )
      ? [tagLookup]
      : input.ref.startsWith(REFS_HEADS_PREFIX)
        ? [branchLookup]
        : [branchLookup, tagLookup];
    let repositoryChecked = false;

    for (const lookup of lookups) {
      try {
        const resolved = await lookup();
        return {ref: input.ref, commit: resolved.commitSha};
      } catch (error) {
        if (!isRefNotFound(error)) throw error;
        if (!repositoryChecked) {
          await this.gitea.getRepository({owner, repo});
          repositoryChecked = true;
        }
      }
    }

    throw new GiteaIntegrationProviderError(
      'ref-not-found',
      `Gitea ref ${formatRefForMessage(input.ref)} does not resolve to a branch or tag`,
    );
  }

  async createCheckoutSpec(
    input: CreateCheckoutSpecInput<GiteaIntegrationConnection>,
  ): Promise<CheckoutSpec> {
    const {owner, repo} = parseGiteaRepositoryLocator(
      input.externalRepositoryId,
      input.connection.externalAccountId,
    );
    const repository = await this.gitea.getRepository({owner, repo});
    const ref = input.ref?.trim() || repository.defaultBranch;

    return {
      repositoryUrl: createCheckoutRepositoryUrl(repository.cloneUrl),
      ref,
      // Gitea has no per-repo, auto-expiring token like a GitHub App installation
      // token, so checkout reuses the long-lived service credential. `expiresAt`
      // is the runner's lease/refresh window, not the token's real expiry: this
      // credential does not actually expire and stays valid if it leaks.
      credentials: {
        username: config.GITEA_SERVICE_USERNAME,
        token: config.GITEA_SERVICE_TOKEN,
        expiresAt: new Date(Date.now() + config.GITEA_CHECKOUT_TTL_SECONDS * 1000),
      },
    };
  }
}

function giteaRepositoryId(repository: Record<string, unknown> | null): string | null {
  const fullName = nonEmptyString(repository?.full_name);
  if (!fullName) return null;
  const separatorIndex = fullName.indexOf('/');
  const owner = separatorIndex > 0 ? fullName.slice(0, separatorIndex) : '';
  const repo = separatorIndex > 0 ? fullName.slice(separatorIndex + 1) : '';
  return owner && repo && !repo.includes('/') ? `${owner}/${repo}` : null;
}

// Gitea mirrors GitHub's webhook envelope but names the handle `username` on some events
// and `login` on others, so both are read before giving up on an actor.
function giteaEventActor(payload: Record<string, unknown>): string | null {
  const sender = asRecord(payload.sender);
  return nonEmptyString(sender?.login) ?? nonEmptyString(sender?.username);
}

function isRefNotFound(error: unknown): boolean {
  return error instanceof GiteaIntegrationProviderError && error.reason === 'ref-not-found';
}

function providerRefName(ref: string): string {
  if (ref.startsWith(REFS_HEADS_PREFIX)) return ref.slice(REFS_HEADS_PREFIX.length);
  if (ref.startsWith(REFS_TAGS_PREFIX)) return ref.slice(REFS_TAGS_PREFIX.length);
  return ref;
}

function formatRefForMessage(ref: string): string {
  return JSON.stringify(ref);
}

function sameGiteaRepository(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
): boolean {
  const firstId = giteaRepositoryId(first);
  const secondId = giteaRepositoryId(second);
  return Boolean(firstId && secondId && firstId.toLowerCase() === secondId.toLowerCase());
}

function createCheckoutRepositoryUrl(cloneUrl: string): string {
  if (!giteaCloneBaseOrigin) return cloneUrl;

  const repositoryUrl = new URL(cloneUrl);

  repositoryUrl.protocol = giteaCloneBaseOrigin.protocol;
  repositoryUrl.host = giteaCloneBaseOrigin.host;

  return repositoryUrl.toString();
}

function toRepositorySnapshot(repository: GiteaRepository): RepositorySnapshot {
  return {
    externalRepositoryId: buildProviderRepositoryId(
      giteaProviderKind,
      `${repository.ownerLogin}/${repository.name}`,
    ),
    owner: repository.ownerLogin,
    name: repository.name,
    fullName: repository.fullName,
    defaultBranch: repository.defaultBranch,
    visibility: toRepositoryVisibility(repository),
    cloneUrl: repository.cloneUrl,
    htmlUrl: repository.htmlUrl,
  };
}

function toRepositoryVisibility(repository: GiteaRepository): RepositoryVisibility {
  return repository.private ? 'private' : 'public';
}

function parseGiteaRepositoryLocator(
  externalRepositoryId: string,
  expectedOwner: string,
): {owner: string; repo: string} {
  const value = parseProviderRepositoryId(externalRepositoryId, giteaProviderKind);
  const separatorIndex = value.indexOf('/');
  const owner = separatorIndex > 0 ? value.slice(0, separatorIndex) : '';
  const repo = separatorIndex > 0 ? value.slice(separatorIndex + 1) : '';
  if (!owner || !repo || repo.includes('/')) {
    throw new GiteaIntegrationProviderError(
      'repository-not-found',
      `Gitea repository id ${externalRepositoryId} must follow the form ${giteaProviderKind}:<owner>/<repo>`,
    );
  }
  // The service token is instance-wide, so the adapter must scope every request
  // to the connection's own account itself; without this an external id naming
  // another org would read its private repos and mint checkout credentials for
  // them. Reported as not-found so it does not confirm an out-of-scope repo.
  if (owner.toLowerCase() !== expectedOwner.toLowerCase()) {
    throw new GiteaIntegrationProviderError(
      'repository-not-found',
      `Gitea repository id ${externalRepositoryId} is not in the ${expectedOwner} account`,
    );
  }

  return {owner, repo};
}

function prefixMatches(path: string, prefix: string): boolean {
  if (!prefix) return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

function parseOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const offset = Number.parseInt(cursor, 10);
  return Number.isNaN(offset) || offset < 0 ? 0 : offset;
}
