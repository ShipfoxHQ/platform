import type {UserContextMembership} from '@shipfox/api-auth-context';
import type {
  IntegrationConnection,
  IntegrationConnectionLifecycleStatus,
} from '@shipfox/api-integration-spi';
import type {GithubApiClient, GithubInstallationDetails} from '#api/client.js';
import {
  GithubInstallationAlreadyLinkedError,
  GithubInstallationNotAuthorizedError,
  GithubInstallStateActorMismatchError,
} from './errors.js';
import {verifyGithubInstallState} from './state.js';

export interface ConnectGithubInstallationInput {
  workspaceId: string;
  installationId: string;
  displayName: string;
  installerUserId: string;
  lifecycleStatus?: IntegrationConnectionLifecycleStatus | undefined;
  installation: {
    installationId: string;
    accountLogin: string;
    accountType: string;
    repositorySelection: string;
    suspendedAt: Date | null;
    deletedAt: Date | null;
    latestEvent: Record<string, unknown>;
    installerUserId: string;
  };
}

export interface HandleGithubCallbackParams {
  github: GithubApiClient;
  code: string;
  installationId: number;
  state: string;
  sessionUserId: string;
  sessionMemberships: ReadonlyArray<UserContextMembership>;
  requireWorkspaceMembership: (params: {
    workspaceId: string;
    userId: string;
    memberships: ReadonlyArray<UserContextMembership>;
  }) => Promise<unknown>;
  getExistingGithubConnection: (input: {
    installationId: string;
  }) => Promise<IntegrationConnection<'github'> | undefined>;
  connectGithubInstallation: (
    input: ConnectGithubInstallationInput,
  ) => Promise<IntegrationConnection<'github'>>;
}

export async function handleGithubCallback(
  params: HandleGithubCallbackParams,
): Promise<IntegrationConnection<'github'>> {
  const claims = verifyGithubInstallState(params.state);
  if (claims.userId !== params.sessionUserId) {
    throw new GithubInstallStateActorMismatchError();
  }
  await params.requireWorkspaceMembership({
    workspaceId: claims.workspaceId,
    userId: claims.userId,
    memberships: params.sessionMemberships,
  });

  const installationIdStr = String(params.installationId);
  const existing = await params.getExistingGithubConnection({installationId: installationIdStr});
  if (existing && existing.workspaceId !== claims.workspaceId) {
    throw new GithubInstallationAlreadyLinkedError(params.installationId);
  }
  if (existing && existing.lifecycleStatus === 'active') {
    return existing;
  }

  const userAccessToken = await params.github.exchangeOAuthCode(params.code);
  const accessible = await userCanAccessInstallation({
    github: params.github,
    userAccessToken,
    installationId: params.installationId,
  });
  if (!accessible) throw new GithubInstallationNotAuthorizedError(params.installationId);

  const installation = await params.github.getInstallation(params.installationId);
  return await params.connectGithubInstallation({
    workspaceId: claims.workspaceId,
    installationId: installationIdStr,
    displayName: `GitHub ${installation.account.login}`,
    installerUserId: claims.userId,
    installation: toConnectionInstallationInput(installation, claims.userId),
  });
}

async function userCanAccessInstallation(params: {
  github: GithubApiClient;
  userAccessToken: string;
  installationId: number;
}): Promise<boolean> {
  let cursor: string | undefined;
  do {
    const page = await params.github.listUserInstallations({
      userAccessToken: params.userAccessToken,
      cursor,
    });
    if (page.installationIds.includes(params.installationId)) return true;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return false;
}

function toConnectionInstallationInput(
  installation: GithubInstallationDetails,
  installerUserId: string,
) {
  return {
    installationId: String(installation.id),
    accountLogin: installation.account.login,
    accountType: installation.account.type,
    repositorySelection: installation.repositorySelection,
    suspendedAt: installation.suspendedAt,
    deletedAt: null,
    latestEvent: installation.raw,
    installerUserId,
  };
}
