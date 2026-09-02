import {
  buildProviderRepositoryId,
  type CheckoutCredentials,
  type CheckoutPermissions,
  type CheckoutSpec,
  type CheckoutTarget,
  type CreateCheckoutCredentialsInput,
  type CreateCheckoutSpecInput,
  type FetchFileInput,
  type FilePage,
  type FileSnapshot,
  type IntegrationConnection,
  IntegrationProviderError,
  isValidResolvableRef,
  type ListFilesInput,
  type ListRepositoriesInput,
  MAX_REPOSITORY_FILE_BYTES,
  normalizeCheckoutTarget,
  parseProviderRepositoryId,
  type RepositoryPage,
  type RepositorySnapshot,
  type ResolveRefInput,
  type ResolveRepositoryInput,
  type SourceControlProvider,
} from '@shipfox/api-integration-spi';
import type {IntegrationProvider} from '#core/entities/provider.js';
import {
  createTestVcsFixture,
  type TestVcsFixture,
  type TestVcsRenewalMode,
} from './test-vcs-fixture.js';

export const TEST_VCS_PROVIDER = 'test-vcs';
type TestVcsConnection = IntegrationConnection<typeof TEST_VCS_PROVIDER>;

const REPOSITORY_PAGE_SIZE = 100;
const MISSING_REF_ERROR_PATTERN = /ambiguous argument|bad revision|unknown revision/u;

export interface TestVcsSourceControlProviderOptions {
  fixture: TestVcsFixture;
  credentialTtlSeconds: number;
}

export interface TestVcsConnectionConfiguration {
  renewalMode: TestVcsRenewalMode;
  refreshAfterSeconds?: number | undefined;
}

export class TestVcsSourceControlProvider implements SourceControlProvider<TestVcsConnection> {
  private readonly connectionConfigurations = new Map<string, TestVcsConnectionConfiguration>();
  private readonly cachedCredentials = new Map<string, CheckoutCredentials>();
  private readonly mintFlights = new Map<string, Promise<CheckoutCredentials>>();
  private failNextMintCount = 0;

  constructor(private readonly options: TestVcsSourceControlProviderOptions) {}

  configureConnection(connectionId: string, configuration: TestVcsConnectionConfiguration): void {
    this.connectionConfigurations.set(connectionId, configuration);
  }

  failNextCredentialMints(count: number): void {
    this.failNextMintCount = count;
  }

  listRepositories(input: ListRepositoriesInput<TestVcsConnection>): Promise<RepositoryPage> {
    const repositories = this.options.fixture.listRepositories(
      input.connection.externalAccountId,
    ).repositories;
    const needle = input.search?.trim().toLowerCase();
    const filtered = needle
      ? repositories.filter((repository) => repository.fullName.toLowerCase().includes(needle))
      : repositories;
    const offset = parseCursor(input.cursor);
    const page = filtered.slice(offset, offset + Math.min(input.limit, REPOSITORY_PAGE_SIZE));
    const consumed = offset + page.length;
    return Promise.resolve({
      repositories: page,
      nextCursor: consumed < filtered.length ? String(consumed) : null,
    });
  }

  resolveRepository(input: ResolveRepositoryInput<TestVcsConnection>): Promise<RepositorySnapshot> {
    const locator = this.repositoryLocator(input.connection, input.externalRepositoryId);
    const repository = this.options.fixture.getRepository(locator.owner, locator.name);
    if (!repository) throw repositoryNotFound(input.externalRepositoryId);
    return Promise.resolve(repository);
  }

  async listFiles(input: ListFilesInput<TestVcsConnection>): Promise<FilePage> {
    const locator = this.repositoryLocator(input.connection, input.externalRepositoryId);
    this.requireRepository(locator);
    try {
      return await this.options.fixture.listFiles({...locator, ...input});
    } catch (error) {
      throw new IntegrationProviderError(
        isMissingRefError(error) ? 'ref-not-found' : 'provider-unavailable',
        `Test VCS could not list files for ${input.externalRepositoryId}`,
      );
    }
  }

  async fetchFile(input: FetchFileInput<TestVcsConnection>): Promise<FileSnapshot> {
    const locator = this.repositoryLocator(input.connection, input.externalRepositoryId);
    this.requireRepository(locator);
    try {
      const file = await this.options.fixture.fetchFile({...locator, ...input});
      if (Buffer.byteLength(file.content, 'utf8') > MAX_REPOSITORY_FILE_BYTES) {
        throw new IntegrationProviderError(
          'content-too-large',
          `Test VCS file ${input.path} is larger than the supported limit`,
        );
      }
      return file;
    } catch (error) {
      if (error instanceof IntegrationProviderError) throw error;
      throw new IntegrationProviderError(
        'file-not-found',
        `Test VCS file ${input.path} was not found in ${input.externalRepositoryId}`,
      );
    }
  }

  resolveTriggerReference(): null {
    return null;
  }

  async resolveRef(input: ResolveRefInput<TestVcsConnection>) {
    const locator = this.repositoryLocator(input.connection, input.externalRepositoryId);
    this.requireRepository(locator);
    if (!isValidResolvableRef(input.ref)) {
      throw new IntegrationProviderError(
        'ref-invalid',
        `Test VCS ref ${JSON.stringify(input.ref)} is not a resolvable branch or tag name`,
      );
    }
    try {
      return await this.options.fixture.resolveRef({...locator, ref: input.ref});
    } catch {
      throw new IntegrationProviderError(
        'ref-not-found',
        `Test VCS ref ${JSON.stringify(input.ref)} was not found in ${input.externalRepositoryId}`,
      );
    }
  }

  async createCheckoutSpec(
    input: CreateCheckoutSpecInput<TestVcsConnection>,
  ): Promise<CheckoutSpec> {
    const target = normalizeTarget(input);
    const locator = this.repositoryLocator(input.connection, target);
    const repository = this.requireRepository(locator);
    const permissions = input.permissions ?? {contents: 'read'};
    const credentials = await this.createCheckoutCredentials({
      connection: input.connection,
      target,
      permissions,
    });
    return {
      repositoryUrl: repository.cloneUrl,
      ref: input.ref?.trim() || repository.defaultBranch,
      target: {
        kind: 'external-id',
        externalRepositoryId: repository.externalRepositoryId,
      },
      credentials,
      ...(permissions.contents === 'write'
        ? {gitAuthor: {name: 'Shipfox Test VCS', email: 'test-vcs@shipfox.test'}}
        : {}),
    };
  }

  async createCheckoutCredentials(
    input: CreateCheckoutCredentialsInput<TestVcsConnection>,
  ): Promise<CheckoutCredentials> {
    const target = normalizeTarget(input);
    const locator = this.repositoryLocator(input.connection, target);
    this.requireRepository(locator);
    const cacheKey = credentialCacheKey(input.connection, locator, input.permissions);
    for (;;) {
      const cached = this.cachedCredentials.get(cacheKey);
      if (
        cached !== undefined &&
        isReusableCredential(cached, this.options.credentialTtlSeconds) &&
        cached.generation !== input.rejectedGeneration
      ) {
        return cached;
      }

      const pending = this.mintFlights.get(cacheKey);
      if (pending !== undefined) {
        const credential = await pending;
        if (credential.generation !== input.rejectedGeneration) return credential;
        continue;
      }

      const operation = Promise.resolve()
        .then(() => this.mintCredential(input, locator, cacheKey))
        .finally(() => {
          if (this.mintFlights.get(cacheKey) === operation) this.mintFlights.delete(cacheKey);
        });
      this.mintFlights.set(cacheKey, operation);
      return await operation;
    }
  }

  async createRepository(input: {
    connection: TestVcsConnection;
    name: string;
    defaultBranch?: string | undefined;
    files: readonly {path: string; content: string}[];
  }): Promise<RepositorySnapshot> {
    return await this.options.fixture.createRepository({
      owner: input.connection.externalAccountId,
      name: input.name,
      defaultBranch: input.defaultBranch,
      files: input.files,
    });
  }

  async commitFiles(input: {
    connection: TestVcsConnection;
    externalRepositoryId: string;
    message: string;
    files: readonly {path: string; content: string}[];
  }): Promise<string> {
    const locator = this.repositoryLocator(input.connection, input.externalRepositoryId);
    this.requireRepository(locator);
    return await this.options.fixture.commitFiles({...locator, ...input});
  }

  stats(owner?: string) {
    return this.options.fixture.stats(owner);
  }

  private mintCredential(
    input: CreateCheckoutCredentialsInput<TestVcsConnection>,
    locator: {owner: string; name: string},
    cacheKey: string,
  ): Promise<CheckoutCredentials> {
    if (this.failNextMintCount > 0) {
      this.failNextMintCount -= 1;
      throw new IntegrationProviderError(
        'provider-unavailable',
        'Test VCS credential minting is unavailable',
      );
    }
    const configuration = this.connectionConfigurations.get(input.connection.id);
    const credential = this.options.fixture.issueCredential({
      ...locator,
      permissions: input.permissions,
      renewalMode: configuration?.renewalMode ?? 'on-rejection',
      ttlSeconds: this.options.credentialTtlSeconds,
      ...(configuration?.refreshAfterSeconds === undefined
        ? {}
        : {refreshAfterSeconds: configuration.refreshAfterSeconds}),
      rejectedGeneration: input.rejectedGeneration,
    });
    this.cachedCredentials.set(cacheKey, credential);
    return Promise.resolve(credential);
  }

  private repositoryLocator(
    connection: TestVcsConnection,
    target: string | CheckoutTarget,
  ): {owner: string; name: string} {
    const externalRepositoryId =
      typeof target === 'string' ? target : checkoutTargetRepositoryId(target);
    const value = parseProviderRepositoryId(externalRepositoryId, TEST_VCS_PROVIDER);
    const separator = value.indexOf('/');
    const owner = separator > 0 ? value.slice(0, separator) : '';
    const name = separator > 0 ? value.slice(separator + 1) : '';
    if (!owner || !name || name.includes('/') || owner !== connection.externalAccountId) {
      throw repositoryNotFound(externalRepositoryId);
    }
    return {owner, name};
  }

  private requireRepository(locator: {owner: string; name: string}): RepositorySnapshot {
    const repository = this.options.fixture.getRepository(locator.owner, locator.name);
    if (!repository)
      throw repositoryNotFound(`${TEST_VCS_PROVIDER}:${locator.owner}/${locator.name}`);
    return repository;
  }
}

export function createTestVcsIntegrationProvider(options: TestVcsSourceControlProviderOptions): {
  provider: IntegrationProvider;
  sourceControl: TestVcsSourceControlProvider;
} {
  const sourceControl = new TestVcsSourceControlProvider(options);
  return {
    sourceControl,
    provider: {
      provider: TEST_VCS_PROVIDER,
      displayName: 'Test VCS',
      adapters: {source_control: sourceControl},
    },
  };
}

export type {TestVcsFixture};
export {createTestVcsFixture};

function normalizeTarget(input: {
  target?: CheckoutTarget | undefined;
  externalRepositoryId?: string | undefined;
}): CheckoutTarget {
  const result = normalizeCheckoutTarget(input);
  if (result.status === 'valid') return result.target;
  if (result.status === 'ambiguous') {
    throw new IntegrationProviderError(
      'provider-rejected',
      'Test VCS checkout input cannot include both a target and an external repository id',
    );
  }
  throw new IntegrationProviderError(
    'repository-not-found',
    'Test VCS checkout input must include a target or external repository id',
  );
}

function checkoutTargetRepositoryId(target: CheckoutTarget): string {
  if (target.kind === 'external-id') return target.externalRepositoryId;
  return buildProviderRepositoryId(TEST_VCS_PROVIDER, `${target.owner}/${target.name}`);
}

function repositoryNotFound(externalRepositoryId: string): IntegrationProviderError {
  return new IntegrationProviderError(
    'repository-not-found',
    `Test VCS repository ${externalRepositoryId} was not found`,
  );
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const value = Number.parseInt(cursor, 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isMissingRefError(error: unknown): boolean {
  return error instanceof Error && MISSING_REF_ERROR_PATTERN.test(error.message);
}

function credentialCacheKey(
  connection: TestVcsConnection,
  locator: {owner: string; name: string},
  permissions: CheckoutPermissions,
): string {
  return JSON.stringify({
    workspaceId: connection.workspaceId,
    provider: connection.provider,
    accountId: connection.externalAccountId,
    repository: `${locator.owner}/${locator.name}`,
    permissions,
  });
}

function isReusableCredential(credential: CheckoutCredentials, ttlSeconds: number): boolean {
  if (
    credential.renewal?.mode === 'refresh-at' &&
    credential.renewal.refreshAt.getTime() <= Date.now()
  ) {
    return false;
  }
  return credential.expiresAt.getTime() > Date.now() + Math.max(50, ttlSeconds * 500);
}
