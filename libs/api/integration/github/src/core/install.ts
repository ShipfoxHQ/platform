import type {GithubApiClient, GithubInstallationDetails} from '#api/client.js';
import type {IntegrationConnection} from './contracts.js';
import {GithubInstallationNotAuthorizedError} from './errors.js';
import {verifyGithubInstallState} from './state.js';

export interface ConnectGithubInstallationInput {
  workspaceId: string;
  installationId: string;
  displayName: string;
  installation: {
    installationId: string;
    accountLogin: string;
    accountType: string;
    repositorySelection: string;
    suspendedAt: Date | null;
    deletedAt: Date | null;
    latestEvent: Record<string, unknown>;
  };
}

export interface HandleGithubCallbackParams {
  github: GithubApiClient;
  code: string;
  installationId: number;
  state: string;
  requireWorkspaceMembership: (params: {workspaceId: string; userId: string}) => Promise<unknown>;
  connectGithubInstallation: (
    input: ConnectGithubInstallationInput,
  ) => Promise<IntegrationConnection>;
}

export async function handleGithubCallback(
  params: HandleGithubCallbackParams,
): Promise<IntegrationConnection> {
  const claims = verifyGithubInstallState(params.state);
  await params.requireWorkspaceMembership({
    workspaceId: claims.workspaceId,
    userId: claims.userId,
  });

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
    installationId: String(params.installationId),
    displayName: `GitHub ${installation.account.login}`,
    installation: toConnectionInstallationInput(installation),
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

function toConnectionInstallationInput(installation: GithubInstallationDetails) {
  return {
    installationId: String(installation.id),
    accountLogin: installation.account.login,
    accountType: installation.account.type,
    repositorySelection: installation.repositorySelection,
    suspendedAt: installation.suspendedAt,
    deletedAt: null,
    latestEvent: installation.raw,
  };
}
