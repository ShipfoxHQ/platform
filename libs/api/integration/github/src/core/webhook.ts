import {
  type GithubPushPayloadDto,
  githubInstallationRepositoriesPayloadSchema,
  githubPushPayloadSchema,
  githubRepositoryDeletedPayloadSchema,
  githubRepositoryRenamedPayloadSchema,
  githubWebhookActionSchema,
  githubWebhookInstallationSchema,
} from '@shipfox/api-integration-github-dto';
import {
  buildProviderRepositoryId,
  type GetIntegrationConnectionByIdFn,
  type IntegrationTx,
  type PublishIntegrationEventReceivedFn,
  type PublishSourcePushFn,
  type PublishSourceRepositoryUpdatedFn,
  type RecordDeliveryOnlyFn,
  type SourcePushPayload,
  type SourceRepositoryIdentity,
} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import {getGithubInstallationByInstallationId} from '#db/installations.js';

const REFS_HEADS_PREFIX = 'refs/heads/';
const GITHUB_SOURCE = 'github';
// GitHub sends a `push` webhook for a branch deletion with `after` set to this all-zero SHA.
const DELETED_BRANCH_SHA = '0'.repeat(40);

export interface HandleGithubEventParams {
  tx: IntegrationTx;
  deliveryId: string;
  event: string;
  payload: unknown;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  publishSourceRepositoryUpdated: PublishSourceRepositoryUpdatedFn;
  publishSourcePush: PublishSourcePushFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export type HandleGithubEventOutcome =
  | 'published'
  | 'duplicate'
  | 'published-envelope'
  | 'duplicate-envelope'
  | 'published-push-envelope-only'
  | 'duplicate-push-envelope-only'
  | 'fork-pull-request'
  | 'unknown-installation'
  | 'missing-connection'
  | 'inactive-connection'
  | 'no-installation-id';

export interface HandleGithubEventResult {
  outcome: HandleGithubEventOutcome;
  installationTokenCleanup?: {workspaceId: string; installationId: number} | undefined;
}

function isBranchDeletion(after: string): boolean {
  return after === DELETED_BRANCH_SHA;
}

interface GithubRepositoryIdentity {
  id?: string;
  fullName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function repositoryIdentity(value: unknown): GithubRepositoryIdentity | undefined {
  if (!isRecord(value)) return undefined;

  const id =
    (typeof value.id === 'number' && Number.isInteger(value.id) ? String(value.id) : undefined) ??
    (typeof value.id === 'string' && value.id.trim() ? value.id.trim() : undefined);
  const fullName =
    typeof value.full_name === 'string' && value.full_name.trim()
      ? value.full_name.trim().toLowerCase()
      : undefined;
  if (!id && !fullName) return undefined;

  return {...(id ? {id} : {}), ...(fullName ? {fullName} : {})};
}

function areSameRepositories(
  head: GithubRepositoryIdentity,
  base: GithubRepositoryIdentity,
): boolean {
  if (head.id && base.id) return head.id === base.id;
  if (head.fullName && base.fullName) return head.fullName === base.fullName;
  return false;
}

function pullRequestRepositories(
  payload: unknown,
):
  | {head: GithubRepositoryIdentity | undefined; base: GithubRepositoryIdentity | undefined}
  | undefined {
  if (!isRecord(payload) || !isRecord(payload.pull_request)) return undefined;

  const pullRequest = payload.pull_request;
  const head = isRecord(pullRequest.head) ? repositoryIdentity(pullRequest.head.repo) : undefined;
  const base =
    (isRecord(pullRequest.base) ? repositoryIdentity(pullRequest.base.repo) : undefined) ??
    repositoryIdentity(payload.repository);
  return {head, base};
}

type GithubConnection = NonNullable<Awaited<ReturnType<GetIntegrationConnectionByIdFn>>>;

async function dispatchGithubEvent(
  params: HandleGithubEventParams,
  connection: GithubConnection,
  installationId: number,
  action: string | undefined,
): Promise<HandleGithubEventResult> {
  if (params.event === 'push') {
    const validated = githubPushPayloadSchema.safeParse(params.payload);
    if (!validated.success) {
      logger().warn(
        {deliveryId: params.deliveryId, issues: validated.error.issues},
        'github webhook push payload failed schema validation; publishing generic envelope only',
      );
      return publishGithubEnvelopeOnly({
        tx: params.tx,
        deliveryId: params.deliveryId,
        payload: params.payload,
        publishIntegrationEventReceived: params.publishIntegrationEventReceived,
        connection,
        event: 'push',
      });
    }
    return publishGithubPush({
      ...params,
      eventPayload: validated.data,
      rawPayload: params.payload,
      connection,
    });
  }

  const eventName = action ? `${params.event}.${action}` : params.event;
  const repositories = normalizeRepositoryUpdates(params.event, action, params.payload);
  if (repositories) {
    const removedRepositories = normalizeRepositoryRemovals(params.event, action, params.payload);
    const result = await params.publishSourceRepositoryUpdated({
      tx: params.tx,
      provider: GITHUB_SOURCE,
      source: connection.slug,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      connectionName: connection.displayName,
      deliveryId: params.deliveryId,
      receivedAt: new Date().toISOString(),
      rawPayload: params.payload,
      event: eventName,
      repositories,
      ...(removedRepositories ? {removedRepositories} : {}),
    });
    return withInstallationTokenCleanup(
      {outcome: result.published ? 'published' : 'duplicate'},
      params.event,
      action,
      connection.workspaceId,
      installationId,
    );
  }

  const result = await publishGithubEnvelopeOnly({
    tx: params.tx,
    deliveryId: params.deliveryId,
    payload: params.payload,
    publishIntegrationEventReceived: params.publishIntegrationEventReceived,
    connection,
    event: eventName,
  });
  return withInstallationTokenCleanup(
    result,
    params.event,
    action,
    connection.workspaceId,
    installationId,
  );
}

export async function handleGithubEvent(
  params: HandleGithubEventParams,
): Promise<HandleGithubEventResult> {
  const actionEnvelope = githubWebhookActionSchema.safeParse(params.payload);
  const action = actionEnvelope.success ? actionEnvelope.data.action : undefined;

  const pullRequestRepos = pullRequestRepositories(params.payload);
  if (
    pullRequestRepos &&
    (!pullRequestRepos.head ||
      !pullRequestRepos.base ||
      !areSameRepositories(pullRequestRepos.head, pullRequestRepos.base))
  ) {
    logger().info(
      {
        deliveryId: params.deliveryId,
        event: params.event,
        reason:
          !pullRequestRepos.head || !pullRequestRepos.base
            ? 'repository_unresolved'
            : 'repositories_differ',
        headRepository: pullRequestRepos.head,
        baseRepository: pullRequestRepos.base,
      },
      'github webhook: fork or indeterminate pull request, dropping',
    );
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: GITHUB_SOURCE,
      deliveryId: params.deliveryId,
    });
    return {outcome: 'fork-pull-request'};
  }

  const installationEnvelope = githubWebhookInstallationSchema.safeParse(params.payload);
  const installationId = installationEnvelope.success
    ? installationEnvelope.data.installation?.id
    : undefined;
  if (installationId === undefined) {
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: GITHUB_SOURCE,
      deliveryId: params.deliveryId,
    });
    return {outcome: 'no-installation-id'};
  }

  const installation = await getGithubInstallationByInstallationId(String(installationId), {
    tx: params.tx,
  });
  if (!installation) {
    logger().warn(
      {deliveryId: params.deliveryId, installationId},
      'github webhook: unknown installation, dropping',
    );
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: GITHUB_SOURCE,
      deliveryId: params.deliveryId,
    });
    return {outcome: 'unknown-installation'};
  }

  const connection = await params.getIntegrationConnectionById(installation.connectionId, {
    tx: params.tx,
  });
  if (!connection) {
    logger().warn(
      {deliveryId: params.deliveryId, installationId, connectionId: installation.connectionId},
      'github webhook: installation has no connection, dropping',
    );
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: GITHUB_SOURCE,
      deliveryId: params.deliveryId,
    });
    return {outcome: 'missing-connection'};
  }

  if (connection.lifecycleStatus !== 'active') {
    const logContext = {
      deliveryId: params.deliveryId,
      installationId,
      connectionId: connection.id,
      workspaceId: connection.workspaceId,
      lifecycleStatus: connection.lifecycleStatus,
    };
    // `disabled` is an expected steady state; only `error` is anomalous.
    if (connection.lifecycleStatus === 'error') {
      logger().warn(logContext, 'github webhook: connection in error state, dropping');
    } else {
      logger().info(logContext, 'github webhook: connection disabled, dropping');
    }
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: GITHUB_SOURCE,
      deliveryId: params.deliveryId,
    });
    return withInstallationTokenCleanup(
      {outcome: 'inactive-connection'},
      params.event,
      action,
      connection.workspaceId,
      installationId,
    );
  }

  return dispatchGithubEvent(params, connection, installationId, action);
}

function normalizeRepositoryUpdates(
  event: string,
  action: string | undefined,
  payload: unknown,
): SourceRepositoryIdentity[] | undefined {
  if (event === 'repository' && action === 'renamed') {
    const parsed = githubRepositoryRenamedPayloadSchema.safeParse(payload);
    if (!parsed.success) return undefined;
    return [toSourceRepositoryIdentity(parsed.data.repository)];
  }

  if (event === 'repository' && action === 'deleted') {
    const parsed = githubRepositoryDeletedPayloadSchema.safeParse(payload);
    if (!parsed.success) return undefined;
    return [toSourceRepositoryIdentity(parsed.data.repository)];
  }

  if (event !== 'installation_repositories' || (action !== 'added' && action !== 'removed')) {
    return undefined;
  }

  const parsed = githubInstallationRepositoriesPayloadSchema.safeParse(payload);
  if (!parsed.success) return undefined;

  const repositories = new Map<number, SourceRepositoryIdentity>();
  for (const repository of [
    ...parsed.data.repositories_added,
    ...parsed.data.repositories_removed,
  ]) {
    const normalized = toSourceRepositoryIdentity(repository);
    repositories.set(repository.id, normalized);
  }
  return repositories.size > 0 ? [...repositories.values()] : undefined;
}

function normalizeRepositoryRemovals(
  event: string,
  action: string | undefined,
  payload: unknown,
): SourceRepositoryIdentity[] | undefined {
  if (event === 'repository' && action === 'deleted') {
    const parsed = githubRepositoryDeletedPayloadSchema.safeParse(payload);
    if (!parsed.success) return undefined;
    return [toSourceRepositoryIdentity(parsed.data.repository)];
  }

  if (event !== 'installation_repositories' || (action !== 'added' && action !== 'removed')) {
    return undefined;
  }

  const parsed = githubInstallationRepositoriesPayloadSchema.safeParse(payload);
  if (!parsed.success || parsed.data.repositories_removed.length === 0) return undefined;

  return parsed.data.repositories_removed.map(toSourceRepositoryIdentity);
}

function toSourceRepositoryIdentity(repository: {
  id: number;
  name: string;
  owner: {login: string};
  default_branch: string;
}): SourceRepositoryIdentity {
  return {
    externalRepositoryId: buildProviderRepositoryId(GITHUB_SOURCE, String(repository.id)),
    owner: repository.owner.login,
    name: repository.name,
    defaultBranch: repository.default_branch,
  };
}

function shouldDeleteInstallationTokenSecret(event: string, action: string | undefined): boolean {
  return event === 'installation' && (action === 'deleted' || action === 'suspend');
}

function withInstallationTokenCleanup(
  result: HandleGithubEventResult,
  event: string,
  action: string | undefined,
  workspaceId: string,
  installationId: number,
): HandleGithubEventResult {
  if (!shouldDeleteInstallationTokenSecret(event, action)) return result;
  return {...result, installationTokenCleanup: {workspaceId, installationId}};
}

async function publishGithubPush(params: {
  tx: IntegrationTx;
  deliveryId: string;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  publishSourcePush: PublishSourcePushFn;
  eventPayload: GithubPushPayloadDto;
  rawPayload: unknown;
  connection: {
    id: string;
    workspaceId: string;
    slug: string;
    displayName: string;
  };
}): Promise<{outcome: HandleGithubEventOutcome}> {
  if (isBranchDeletion(params.eventPayload.after)) {
    const result = await params.publishIntegrationEventReceived({
      tx: params.tx,
      event: {
        provider: GITHUB_SOURCE,
        source: params.connection.slug,
        event: 'push',
        workspaceId: params.connection.workspaceId,
        connectionId: params.connection.id,
        connectionName: params.connection.displayName,
        deliveryId: params.deliveryId,
        receivedAt: new Date().toISOString(),
        payload: params.rawPayload,
      },
    });
    return {
      outcome: result.published ? 'published-push-envelope-only' : 'duplicate-push-envelope-only',
    };
  }

  const ref = stripRefsHeads(params.eventPayload.ref);
  const defaultBranch = params.eventPayload.repository.default_branch;
  const push: SourcePushPayload = {
    externalRepositoryId: buildProviderRepositoryId(
      GITHUB_SOURCE,
      String(params.eventPayload.repository.id),
    ),
    ref,
    headCommitSha: params.eventPayload.after,
    defaultBranch,
    isDefaultBranch: ref === defaultBranch,
  };
  const result = await params.publishSourcePush({
    tx: params.tx,
    provider: GITHUB_SOURCE,
    source: params.connection.slug,
    workspaceId: params.connection.workspaceId,
    connectionId: params.connection.id,
    connectionName: params.connection.displayName,
    deliveryId: params.deliveryId,
    receivedAt: new Date().toISOString(),
    rawPayload: params.rawPayload,
    push,
  });

  return {outcome: result.published ? 'published' : 'duplicate'};
}

async function publishGithubEnvelopeOnly(params: {
  tx: IntegrationTx;
  deliveryId: string;
  payload: unknown;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  connection: {id: string; workspaceId: string; slug: string; displayName: string};
  event: string;
}): Promise<{outcome: HandleGithubEventOutcome}> {
  const result = await params.publishIntegrationEventReceived({
    tx: params.tx,
    event: {
      provider: GITHUB_SOURCE,
      source: params.connection.slug,
      event: params.event,
      workspaceId: params.connection.workspaceId,
      connectionId: params.connection.id,
      connectionName: params.connection.displayName,
      deliveryId: params.deliveryId,
      receivedAt: new Date().toISOString(),
      payload: params.payload,
    },
  });
  return {outcome: result.published ? 'published-envelope' : 'duplicate-envelope'};
}

function stripRefsHeads(ref: string): string {
  return ref.startsWith(REFS_HEADS_PREFIX) ? ref.slice(REFS_HEADS_PREFIX.length) : ref;
}
