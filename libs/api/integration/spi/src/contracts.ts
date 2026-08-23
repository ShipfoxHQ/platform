export type IntegrationProviderKind = string;
export type IntegrationCapability = 'source_control' | 'agent_tools';
export type IntegrationConnectionLifecycleStatus = 'active' | 'disabled' | 'error';

const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const ZERO_GIT_OBJECT_ID_PATTERN = /^0+$/;

export interface IntegrationConnection<
  ProviderKind extends IntegrationProviderKind = IntegrationProviderKind,
> {
  id: string;
  workspaceId: string;
  provider: ProviderKind;
  externalAccountId: string;
  slug: string;
  displayName: string;
  lifecycleStatus: IntegrationConnectionLifecycleStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type RepositoryVisibility = 'public' | 'private' | 'internal' | 'unknown';

export interface RepositorySnapshot {
  externalRepositoryId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  visibility: RepositoryVisibility;
  cloneUrl: string;
  htmlUrl: string;
}

export interface RepositoryPage {
  repositories: RepositorySnapshot[];
  nextCursor: string | null;
}

export interface ListRepositoriesInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  connection: Connection;
  limit: number;
  cursor?: string | undefined;
  search?: string | undefined;
}

export interface ResolveRepositoryInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  connection: Connection;
  externalRepositoryId: string;
}

export interface ResolveRefInput<Connection extends IntegrationConnection = IntegrationConnection>
  extends ResolveRepositoryInput<Connection> {
  ref: string;
}

export interface ResolvedRef {
  ref: string;
  commit: string;
}

export interface FileSnapshot {
  path: string;
  ref: string;
  content: string;
}

export interface FileEntry {
  path: string;
  type: 'file';
  size: number | null;
}

export interface FilePage {
  files: FileEntry[];
  nextCursor: string | null;
}

export interface ListFilesInput<Connection extends IntegrationConnection = IntegrationConnection>
  extends ResolveRepositoryInput<Connection> {
  ref: string;
  prefix: string;
  limit: number;
  cursor?: string | undefined;
}

export interface FetchFileInput<Connection extends IntegrationConnection = IntegrationConnection>
  extends ResolveRepositoryInput<Connection> {
  ref: string;
  path: string;
}

export interface CheckoutCredentials {
  username: string;
  token: string;
  expiresAt: Date;
}

export interface CheckoutGitAuthor {
  name: string;
  email: string;
}

export interface CheckoutPermissions {
  contents: 'read' | 'write';
}

export interface CheckoutSpec {
  repositoryUrl: string;
  ref: string;
  credentials?: CheckoutCredentials | undefined;
  gitAuthor?: CheckoutGitAuthor | undefined;
}

export interface CreateCheckoutSpecInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> extends ResolveRepositoryInput<Connection> {
  ref?: string | undefined;
  permissions?: CheckoutPermissions | undefined;
}

export interface TriggerReference {
  externalRepositoryId: string;
  ref: string;
  commit: string;
  /** Provider handle of whoever caused the event, when the payload names one. */
  actor: string | null;
}

export interface SourceControlProvider<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  listRepositories(input: ListRepositoriesInput<Connection>): Promise<RepositoryPage>;
  resolveRepository(input: ResolveRepositoryInput<Connection>): Promise<RepositorySnapshot>;
  listFiles(input: ListFilesInput<Connection>): Promise<FilePage>;
  fetchFile(input: FetchFileInput<Connection>): Promise<FileSnapshot>;
  resolveTriggerReference(payload: unknown): TriggerReference | null;
  /**
   * Pins a branch or tag name to the commit it currently points at.
   * The snapshot can become unreachable before a caller uses it.
   */
  resolveRef(input: ResolveRefInput<Connection>): Promise<ResolvedRef>;
  createCheckoutSpec?(input: CreateCheckoutSpecInput<Connection>): Promise<CheckoutSpec>;
}

export type AgentToolSensitivity = 'read' | 'write';
export type AgentToolJsonSchema = Record<string, unknown>;

export interface AgentToolCatalogMethod<RequiredScope = unknown> {
  id: string;
  description: string;
  sensitivity: AgentToolSensitivity;
  sensitive: boolean;
  requiredScope: RequiredScope;
}

export interface AgentToolCatalogEntry<RequiredScope = unknown> {
  id: string;
  description: string;
  sensitivity: AgentToolSensitivity;
  sensitive: boolean;
  requiredScope: RequiredScope;
  inputSchema: AgentToolJsonSchema;
  outputSchema?: AgentToolJsonSchema | undefined;
  methods?: readonly AgentToolCatalogMethod<RequiredScope>[] | undefined;
}

export type AgentToolSelectorKind = 'family' | 'family_wildcard' | 'method' | 'standalone';

export interface AgentToolSelector {
  readonly token: string;
  readonly kind: AgentToolSelectorKind;
  readonly sensitivity: AgentToolSensitivity;
  readonly sensitive: boolean;
}

export interface AgentToolSelectionCatalog {
  readonly selectors: readonly AgentToolSelector[];
}

export interface AgentToolCallInput {
  toolId: string;
  arguments: Record<string, unknown>;
}

export interface AgentToolSession<CallResult = unknown> {
  call(input: AgentToolCallInput): Promise<CallResult>;
  close?(): Promise<void>;
}

export interface OpenAgentToolsSessionInput<
  Connection extends IntegrationConnection = IntegrationConnection,
  RequiredScope = unknown,
  ProviderScope = unknown,
> {
  connection: Connection;
  tools: readonly AgentToolCatalogEntry<RequiredScope>[];
  scope: ProviderScope;
}

export interface AgentToolsProvider<
  Connection extends IntegrationConnection = IntegrationConnection,
  RequiredScope = unknown,
  ProviderScope = unknown,
  CallResult = unknown,
> {
  catalog():
    | readonly AgentToolCatalogEntry<RequiredScope>[]
    | Promise<readonly AgentToolCatalogEntry<RequiredScope>[]>;
  selectionCatalog(): AgentToolSelectionCatalog | Promise<AgentToolSelectionCatalog>;
  openSession(
    input: OpenAgentToolsSessionInput<Connection, RequiredScope, ProviderScope>,
  ): Promise<AgentToolSession<CallResult>>;
}

export interface IntegrationProviderAdapters<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  source_control?: SourceControlProvider<Connection> | undefined;
  agent_tools?: AgentToolsProvider<Connection> | undefined;
}

/** Processes one provider-neutral inbound webhook request. */
export interface WebhookRequestProcessor {
  process(
    request: import('@shipfox/api-integration-core-dto').StoredWebhookRequest,
  ): Promise<import('@shipfox/api-integration-core-dto').WebhookProcessingResult>;
}

export interface IntegrationProvider<
  ProviderKind extends IntegrationProviderKind = IntegrationProviderKind,
  Route = unknown,
  Connection extends IntegrationConnection<ProviderKind> = IntegrationConnection<ProviderKind>,
> {
  provider: ProviderKind;
  displayName: string;
  adapters?: IntegrationProviderAdapters<Connection> | undefined;
  routes?: Route[] | undefined;
  connectionExternalUrl?(connection: Connection): Promise<string | undefined>;
  /** Prepares provider-owned remote cleanup and returns a callback for after local deletion commits. */
  deleteConnectionRemoteResources?(
    connection: Connection,
  ): Promise<(() => Promise<void>) | undefined>;
  /** Serializes connection deletion with provider operations that can recreate remote resources. */
  withConnectionDeletionLock?(connection: Connection, fn: () => Promise<void>): Promise<void>;
  deleteConnectionRecords?(connection: Connection, options: {tx: unknown}): Promise<void>;
  deleteConnectionSecrets?(connection: Connection): Promise<void>;
}

export interface RegisteredIntegrationProvider<
  ProviderKind extends IntegrationProviderKind = IntegrationProviderKind,
  Route = unknown,
  Connection extends IntegrationConnection<ProviderKind> = IntegrationConnection<ProviderKind>,
> extends IntegrationProvider<ProviderKind, Route, Connection> {
  adapters: IntegrationProviderAdapters<Connection>;
  capabilities: IntegrationCapability[];
}

export type IntegrationProviderErrorReason =
  | 'repository-not-found'
  | 'installation-not-found'
  | 'file-not-found'
  | 'ref-not-found'
  | 'ref-invalid'
  | 'access-denied'
  | 'rate-limited'
  | 'timeout'
  | 'provider-unavailable'
  | 'provider-rejected'
  | 'malformed-provider-response'
  | 'content-too-large'
  | 'too-many-files';

export class IntegrationProviderError extends Error {
  constructor(
    public readonly reason: IntegrationProviderErrorReason,
    message: string,
    public readonly retryAfterSeconds?: number | undefined,
    public readonly status?: number | undefined,
  ) {
    super(message);
    this.name = 'IntegrationProviderError';
  }
}

export class ConnectionSlugConflictError extends Error {
  constructor(cause: unknown) {
    super('Could not allocate a unique integration connection slug. Try again.', {cause});
    this.name = 'ConnectionSlugConflictError';
  }
}

export const MAX_REPOSITORY_FILE_BYTES = 1_000_000;

export function buildProviderRepositoryId(
  provider: IntegrationProviderKind,
  value: string,
): string {
  return `${provider}:${value}`;
}

export function parseProviderRepositoryId(
  externalRepositoryId: string,
  expectedProvider: IntegrationProviderKind,
): string {
  const separatorIndex = externalRepositoryId.indexOf(':');
  if (separatorIndex <= 0) {
    throw new IntegrationProviderError(
      'repository-not-found',
      `External repository id is missing a provider prefix: ${externalRepositoryId}`,
    );
  }
  const prefix = externalRepositoryId.slice(0, separatorIndex);
  const value = externalRepositoryId.slice(separatorIndex + 1);
  if (prefix !== expectedProvider) {
    throw new IntegrationProviderError(
      'repository-not-found',
      `External repository id ${externalRepositoryId} is not owned by provider ${expectedProvider}`,
    );
  }
  if (!value) {
    throw new IntegrationProviderError(
      'repository-not-found',
      `External repository id ${externalRepositoryId} is missing a provider-owned value`,
    );
  }
  return value;
}

/** Checks the constraints enforced by `git check-ref-format`. */
export function isValidGitRefName(ref: string): boolean {
  if (!ref || ref === '@' || ref.startsWith('-')) return false;
  if (
    !ref.includes('/') ||
    ref.startsWith('/') ||
    ref.endsWith('/') ||
    ref.includes('//') ||
    ref.includes('..') ||
    ref.includes('@{') ||
    ref.endsWith('.')
  ) {
    return false;
  }
  if (
    [...ref].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x20 || code === 0x7f || '~^:?*[]\\'.includes(character);
    })
  ) {
    return false;
  }

  const components = ref.split('/');
  return components.every(
    (component) =>
      component.length > 0 && !component.startsWith('.') && !component.endsWith('.lock'),
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** Validates a provider ref before it is passed to a git operation. */
export function isValidTriggerRef(ref: string): boolean {
  return isValidGitRefName(ref);
}

/**
 * Validates a ref the platform may resolve to a commit: any safe git ref name
 * except pull-request refs. Raw object ids do not satisfy the safe git ref
 * name rules because valid refs must contain a slash. `refs/pull/N/head` can
 * point at a fork and providers serve any commit in the repository network by
 * SHA, so accepting names only keeps resolutions on refs a member pushed to
 * the project repository.
 */
export function isValidResolvableRef(ref: string): boolean {
  return isValidTriggerRef(ref) && !ref.startsWith('refs/pull/');
}

export function isValidGitObjectId(value: string): boolean {
  return GIT_OBJECT_ID_PATTERN.test(value) && !ZERO_GIT_OBJECT_ID_PATTERN.test(value);
}
