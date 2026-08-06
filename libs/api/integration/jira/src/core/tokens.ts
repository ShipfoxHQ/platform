import type {IntegrationConnectionLifecycleStatus} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import {createJiraApiClient, type JiraApiClient} from '#api/client.js';
import {
  JiraAccessTokenMissingError,
  JiraConnectionNotFoundError,
  JiraIntegrationProviderError,
  JiraTokenUnrefreshableError,
} from '#core/errors.js';
import {
  getJiraInstallationByConnectionId,
  updateJiraInstallationTokenExpiry,
  withJiraRefreshLock,
  withJiraRefreshLockAndWait,
} from '#db/installations.js';

const ACCESS_TOKEN_KEY = 'ACCESS_TOKEN';
const REFRESH_TOKEN_KEY = 'REFRESH_TOKEN';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface JiraConnectionResolverResult {
  workspaceId: string;
  lifecycleStatus: IntegrationConnectionLifecycleStatus;
}

export interface JiraSecretsStore {
  getSecret(params: {workspaceId: string; namespace: string; key: string}): Promise<string | null>;
  setSecrets(params: {
    workspaceId: string;
    namespace: string;
    values: Record<string, string>;
    editedBy?: string | null | undefined;
  }): Promise<void>;
}

export interface CreateJiraTokenStoreParams {
  resolveConnection(connectionId: string): Promise<JiraConnectionResolverResult | undefined>;
  secrets: JiraSecretsStore;
  client?: JiraApiClient | undefined;
  markConnectionError?: (params: {connectionId: string}) => Promise<void>;
}

export interface StoreJiraTokensParams {
  connectionId: string;
  accessToken: string;
  refreshToken?: string | undefined;
  editedBy?: string | null | undefined;
}

export interface GetJiraAccessTokenParams {
  connectionId: string;
  forceRefresh?: boolean | undefined;
  /** Allows cleanup to use the stored token after a connection leaves the active state. */
  allowInactive?: boolean | undefined;
}

export interface JiraTokenStore {
  storeTokens(params: StoreJiraTokensParams): Promise<void>;
  getAccessToken(params: GetJiraAccessTokenParams): Promise<string>;
}

export function jiraSecretsNamespace(connectionId: string): string {
  return `system/integrations/jira/${connectionId}`;
}

export function createJiraTokenStore(params: CreateJiraTokenStoreParams): JiraTokenStore {
  const client = params.client ?? createJiraApiClient();
  const tokenRefreshes = new Map<string, Promise<string>>();
  const refreshStateUnknownConnections = new Set<string>();
  const credentialGenerations = new Map<string, number>();
  const credentialWriteQueues = new Map<string, Promise<void>>();
  const currentCredentialGeneration = (connectionId: string): number =>
    credentialGenerations.get(connectionId) ?? 0;
  const advanceCredentialGeneration = (connectionId: string): number => {
    const generation = currentCredentialGeneration(connectionId) + 1;
    credentialGenerations.set(connectionId, generation);
    return generation;
  };
  function withCredentialWrite<T>(connectionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = credentialWriteQueues.get(connectionId) ?? Promise.resolve();
    const operationResult = previous.then(operation);
    const completion = operationResult.then(
      () => undefined,
      () => undefined,
    );
    credentialWriteQueues.set(connectionId, completion);
    return operationResult.finally(() => {
      if (credentialWriteQueues.get(connectionId) === completion) {
        credentialWriteQueues.delete(connectionId);
      }
    });
  }
  async function waitForCredentialWrites(connectionId: string): Promise<void> {
    await credentialWriteQueues.get(connectionId);
  }
  async function resolveConnection(connectionId: string): Promise<JiraConnectionResolverResult> {
    const connection = await params.resolveConnection(connectionId);
    if (!connection) throw new JiraConnectionNotFoundError(connectionId);
    return connection;
  }
  async function resolveWorkspaceId(connectionId: string): Promise<string> {
    return (await resolveConnection(connectionId)).workspaceId;
  }
  function clearTokenRefresh(connectionId: string, refresh: Promise<string>): void {
    if (tokenRefreshes.get(connectionId) === refresh) tokenRefreshes.delete(connectionId);
  }
  const readSecretToken = (
    workspaceId: string,
    connectionId: string,
    key: typeof ACCESS_TOKEN_KEY | typeof REFRESH_TOKEN_KEY,
  ) => params.secrets.getSecret({workspaceId, namespace: jiraSecretsNamespace(connectionId), key});
  async function readAccessToken(workspaceId: string, connectionId: string): Promise<string> {
    const token = await readSecretToken(workspaceId, connectionId, ACCESS_TOKEN_KEY);
    if (!token) throw new JiraAccessTokenMissingError(connectionId);
    return token;
  }

  return {
    async storeTokens(input) {
      const credentialGeneration = advanceCredentialGeneration(input.connectionId);
      tokenRefreshes.delete(input.connectionId);
      await withJiraRefreshLockAndWait(input.connectionId, () =>
        withCredentialWrite(input.connectionId, async () => {
          if (currentCredentialGeneration(input.connectionId) !== credentialGeneration) return;
          const workspaceId = await resolveWorkspaceId(input.connectionId);
          if (currentCredentialGeneration(input.connectionId) !== credentialGeneration) return;
          const values: Record<string, string> = {[ACCESS_TOKEN_KEY]: input.accessToken};
          if (input.refreshToken) values[REFRESH_TOKEN_KEY] = input.refreshToken;
          await params.secrets.setSecrets({
            workspaceId,
            namespace: jiraSecretsNamespace(input.connectionId),
            values,
            editedBy: input.editedBy,
          });
          if (currentCredentialGeneration(input.connectionId) === credentialGeneration) {
            refreshStateUnknownConnections.delete(input.connectionId);
          }
        }),
      );
    },
    async getAccessToken(input) {
      await waitForCredentialWrites(input.connectionId);
      const connection = await resolveConnection(input.connectionId);
      if (!input.allowInactive && connection.lifecycleStatus !== 'active') {
        throw new JiraTokenUnrefreshableError(input.connectionId);
      }
      await waitForCredentialWrites(input.connectionId);
      if (!input.allowInactive && refreshStateUnknownConnections.has(input.connectionId)) {
        throw new JiraTokenUnrefreshableError(input.connectionId);
      }
      const credentialGeneration = currentCredentialGeneration(input.connectionId);
      const workspaceId = connection.workspaceId;
      const accessToken = await readAccessToken(workspaceId, input.connectionId);
      if (input.allowInactive) return accessToken;
      if (
        !input.forceRefresh &&
        !shouldRefresh(
          (await getJiraInstallationByConnectionId(input.connectionId))?.tokenExpiresAt ?? null,
        )
      )
        return accessToken;
      const inFlight = tokenRefreshes.get(input.connectionId);
      if (inFlight) return inFlight;
      const refresh = refreshAccessTokenWithLock({
        connectionId: input.connectionId,
        workspaceId,
        originalAccessToken: accessToken,
        forceRefresh: input.forceRefresh === true,
        client,
        secrets: params.secrets,
        readAccessToken,
        readSecretToken,
        markConnectionError: params.markConnectionError,
        withCredentialWrite,
        waitForCredentialWrites,
        isCurrentCredentialGeneration: () =>
          currentCredentialGeneration(input.connectionId) === credentialGeneration,
      });
      tokenRefreshes.set(input.connectionId, refresh);
      void refresh.then(
        () => clearTokenRefresh(input.connectionId, refresh),
        (error) => {
          if (
            isTerminalRefreshFailure(error) &&
            currentCredentialGeneration(input.connectionId) === credentialGeneration
          ) {
            refreshStateUnknownConnections.add(input.connectionId);
          }
          clearTokenRefresh(input.connectionId, refresh);
        },
      );
      return refresh;
    },
  };
}

function shouldRefresh(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() <= Date.now() + TOKEN_REFRESH_MARGIN_MS;
}

async function refreshAccessTokenWithLock(params: {
  connectionId: string;
  workspaceId: string;
  originalAccessToken: string;
  forceRefresh: boolean;
  client: JiraApiClient;
  secrets: JiraSecretsStore;
  readAccessToken(workspaceId: string, connectionId: string): Promise<string>;
  readSecretToken(
    workspaceId: string,
    connectionId: string,
    key: typeof ACCESS_TOKEN_KEY | typeof REFRESH_TOKEN_KEY,
  ): Promise<string | null>;
  markConnectionError?: ((params: {connectionId: string}) => Promise<void>) | undefined;
  withCredentialWrite<T>(connectionId: string, operation: () => Promise<T>): Promise<T>;
  waitForCredentialWrites(connectionId: string): Promise<void>;
  isCurrentCredentialGeneration(): boolean;
}): Promise<string> {
  const lock = await withJiraRefreshLock(params.connectionId, () =>
    refreshAccessTokenForConnection(params),
  );
  if (lock.acquired) return lock.value;
  if (!params.isCurrentCredentialGeneration()) {
    return params.readAccessToken(params.workspaceId, params.connectionId);
  }
  const reread = await params.readAccessToken(params.workspaceId, params.connectionId);
  if (reread !== params.originalAccessToken) return reread;
  throw new JiraIntegrationProviderError(
    'provider-unavailable',
    'Jira token refresh is already in progress',
  );
}

async function refreshAccessTokenForConnection(params: {
  connectionId: string;
  workspaceId: string;
  originalAccessToken: string;
  forceRefresh: boolean;
  client: JiraApiClient;
  secrets: JiraSecretsStore;
  readAccessToken(workspaceId: string, connectionId: string): Promise<string>;
  readSecretToken(
    workspaceId: string,
    connectionId: string,
    key: typeof ACCESS_TOKEN_KEY | typeof REFRESH_TOKEN_KEY,
  ): Promise<string | null>;
  markConnectionError?: ((params: {connectionId: string}) => Promise<void>) | undefined;
  withCredentialWrite<T>(connectionId: string, operation: () => Promise<T>): Promise<T>;
  waitForCredentialWrites(connectionId: string): Promise<void>;
  isCurrentCredentialGeneration(): boolean;
}): Promise<string> {
  if (!params.isCurrentCredentialGeneration()) {
    return params.readAccessToken(params.workspaceId, params.connectionId);
  }
  const current = await params.readAccessToken(params.workspaceId, params.connectionId);
  const installation = await getJiraInstallationByConnectionId(params.connectionId);
  if (
    current !== params.originalAccessToken ||
    (!params.forceRefresh && !shouldRefresh(installation?.tokenExpiresAt ?? null))
  )
    return current;
  const refreshToken = await params.readSecretToken(
    params.workspaceId,
    params.connectionId,
    REFRESH_TOKEN_KEY,
  );
  if (!refreshToken) {
    if (params.forceRefresh || shouldRefresh(installation?.tokenExpiresAt ?? null))
      throw new JiraTokenUnrefreshableError(params.connectionId);
    return current;
  }
  try {
    const refreshed = await params.client.refreshAccessToken({refreshToken});
    const refreshedRefreshToken = refreshed.refreshToken;
    if (!refreshedRefreshToken) throw new JiraTokenUnrefreshableError(params.connectionId);
    const persisted = await params.withCredentialWrite(params.connectionId, async () => {
      if (!params.isCurrentCredentialGeneration()) return false;
      await params.secrets.setSecrets({
        workspaceId: params.workspaceId,
        namespace: jiraSecretsNamespace(params.connectionId),
        values: {
          [ACCESS_TOKEN_KEY]: refreshed.accessToken,
          [REFRESH_TOKEN_KEY]: refreshedRefreshToken,
        },
      });
      if (!params.isCurrentCredentialGeneration()) return false;
      await updateJiraInstallationTokenExpiry({
        connectionId: params.connectionId,
        tokenExpiresAt: refreshed.expiresAt ?? null,
        scopes: refreshed.scopes.length > 0 ? refreshed.scopes : undefined,
      });
      return true;
    });
    if (!persisted || !params.isCurrentCredentialGeneration()) {
      await params.waitForCredentialWrites(params.connectionId);
      return params.readAccessToken(params.workspaceId, params.connectionId);
    }
    return refreshed.accessToken;
  } catch (error) {
    if (isTerminalRefreshFailure(error)) {
      await markConnectionError({
        callback: params.markConnectionError,
        connectionId: params.connectionId,
        isCurrentCredentialGeneration: params.isCurrentCredentialGeneration,
        withCredentialWrite: params.withCredentialWrite,
      });
    }
    throw error;
  }
}

function isTerminalRefreshFailure(error: unknown): boolean {
  return (
    error instanceof JiraIntegrationProviderError &&
    (error.reason === 'access-denied' || error.reason === 'timeout')
  );
}

async function markConnectionError(params: {
  callback: CreateJiraTokenStoreParams['markConnectionError'];
  connectionId: string;
  isCurrentCredentialGeneration(): boolean;
  withCredentialWrite<T>(connectionId: string, operation: () => Promise<T>): Promise<T>;
}): Promise<void> {
  if (!params.isCurrentCredentialGeneration()) return;
  try {
    await params.withCredentialWrite(params.connectionId, async () => {
      if (!params.isCurrentCredentialGeneration()) return;
      await params.callback?.({connectionId: params.connectionId});
    });
  } catch (error) {
    logger().warn(
      {err: error, connectionId: params.connectionId},
      'Jira connection error-state update failed after token refresh failure',
    );
  }
}
