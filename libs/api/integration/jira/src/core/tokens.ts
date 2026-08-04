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
      const workspaceId = await resolveWorkspaceId(input.connectionId);
      const values: Record<string, string> = {[ACCESS_TOKEN_KEY]: input.accessToken};
      if (input.refreshToken) values[REFRESH_TOKEN_KEY] = input.refreshToken;
      await params.secrets.setSecrets({
        workspaceId,
        namespace: jiraSecretsNamespace(input.connectionId),
        values,
        editedBy: input.editedBy,
      });
      refreshStateUnknownConnections.delete(input.connectionId);
    },
    async getAccessToken(input) {
      const connection = await resolveConnection(input.connectionId);
      if (connection.lifecycleStatus !== 'active') {
        throw new JiraTokenUnrefreshableError(input.connectionId);
      }
      if (refreshStateUnknownConnections.has(input.connectionId)) {
        throw new JiraTokenUnrefreshableError(input.connectionId);
      }
      const workspaceId = connection.workspaceId;
      const accessToken = await readAccessToken(workspaceId, input.connectionId);
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
      });
      tokenRefreshes.set(input.connectionId, refresh);
      void refresh.then(
        () => clearTokenRefresh(input.connectionId, refresh),
        (error) => {
          if (isTerminalRefreshFailure(error)) {
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
}): Promise<string> {
  const lock = await withJiraRefreshLock(params.connectionId, () =>
    refreshAccessTokenForConnection(params),
  );
  if (lock.acquired) return lock.value;
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
}): Promise<string> {
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
    if (!refreshed.refreshToken) throw new JiraTokenUnrefreshableError(params.connectionId);
    await params.secrets.setSecrets({
      workspaceId: params.workspaceId,
      namespace: jiraSecretsNamespace(params.connectionId),
      values: {
        [ACCESS_TOKEN_KEY]: refreshed.accessToken,
        [REFRESH_TOKEN_KEY]: refreshed.refreshToken,
      },
    });
    await updateJiraInstallationTokenExpiry({
      connectionId: params.connectionId,
      tokenExpiresAt: refreshed.expiresAt ?? null,
      scopes: refreshed.scopes.length > 0 ? refreshed.scopes : undefined,
    });
    return refreshed.accessToken;
  } catch (error) {
    if (isTerminalRefreshFailure(error)) {
      await markConnectionError(params.markConnectionError, params.connectionId);
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

async function markConnectionError(
  markConnectionErrorCallback: CreateJiraTokenStoreParams['markConnectionError'],
  connectionId: string,
): Promise<void> {
  try {
    await markConnectionErrorCallback?.({connectionId});
  } catch (error) {
    logger().warn(
      {err: error, connectionId},
      'Jira connection error-state update failed after token refresh failure',
    );
  }
}
