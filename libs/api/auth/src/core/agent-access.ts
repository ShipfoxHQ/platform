import {OAUTH_READ_SCOPE} from '@shipfox/api-auth-dto';
import {
  type WorkspacesInterModuleClient,
  workspacesInterModuleContract,
} from '@shipfox/api-workspaces-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {
  type AgentGrantSummaryRecord,
  type AgentPersonalAccessTokenSummaryRecord,
  createAgentPersonalAccessTokenForActiveUser,
  listAgentGrantSummaries,
  listAgentPersonalAccessTokenSummaries,
  revokeAgentGrantForUser,
  revokeAgentPersonalAccessTokenForUser,
} from '#db/agent-access.js';
import type {AgentGrant, AgentPersonalAccessToken} from './entities/agent-access.js';
import {
  AgentAccessUserInactiveError,
  AgentAccessWorkspaceError,
  AgentGrantNotFoundError,
  AgentPersonalAccessTokenNotFoundError,
  AuthDependencyUnavailableError,
} from './errors.js';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export const AGENT_PAT_EXPIRY_DAYS = [30, 90, 365] as const;
export type AgentPatExpiryDays = (typeof AGENT_PAT_EXPIRY_DAYS)[number];

export type AgentGrantSummary = AgentGrantSummaryRecord;
export type AgentPersonalAccessTokenSummary = AgentPersonalAccessTokenSummaryRecord;

export interface CreateAgentPersonalAccessTokenParams {
  userId: string;
  workspaceId: string;
  name: string;
  expiresInDays?: AgentPatExpiryDays;
  now?: Date;
}

export interface CreateAgentPersonalAccessTokenResult {
  token: string;
  pat: AgentPersonalAccessToken;
}

function isAgentPatExpiryDays(value: number): value is AgentPatExpiryDays {
  return (AGENT_PAT_EXPIRY_DAYS as readonly number[]).includes(value);
}

function workspaceErrorForStatus(status: string): AgentAccessWorkspaceError {
  return new AgentAccessWorkspaceError(
    status === 'suspended' ? 'workspace-suspended' : 'workspace-inactive',
  );
}

async function currentAgentMemberships(params: {
  userId: string;
  workspaces: WorkspacesInterModuleClient;
}): Promise<Awaited<ReturnType<WorkspacesInterModuleClient['listMembershipsForTokenClaims']>>> {
  try {
    return await params.workspaces.listMembershipsForTokenClaims({userId: params.userId});
  } catch (error) {
    if (error instanceof AuthDependencyUnavailableError) throw error;
    throw new AuthDependencyUnavailableError('workspaces', error);
  }
}

function assertActiveAgentMembershipSnapshot(params: {
  workspaceId: string;
  memberships: Awaited<
    ReturnType<WorkspacesInterModuleClient['listMembershipsForTokenClaims']>
  >['memberships'];
}): void {
  const membership = params.memberships.find(
    (candidate) => candidate.workspaceId === params.workspaceId,
  );
  if (!membership) throw new AgentAccessWorkspaceError('membership-required');
  if (membership.workspaceStatus !== 'active') {
    throw workspaceErrorForStatus(membership.workspaceStatus);
  }
}

async function assertActiveAgentMembership(params: {
  userId: string;
  workspaceId: string;
  memberships: Awaited<
    ReturnType<WorkspacesInterModuleClient['listMembershipsForTokenClaims']>
  >['memberships'];
  workspaces: WorkspacesInterModuleClient;
}): Promise<void> {
  try {
    await params.workspaces.requireActiveMembership({
      userId: params.userId,
      workspaceId: params.workspaceId,
      memberships: params.memberships,
    });
  } catch (error) {
    if (
      isInterModuleKnownError(workspacesInterModuleContract.methods.requireActiveMembership, error)
    ) {
      if (error.code === 'membership-required') {
        throw new AgentAccessWorkspaceError('membership-required');
      }
      if (error.code === 'workspace-inactive' || error.code === 'workspace-not-found') {
        throw new AgentAccessWorkspaceError('workspace-inactive');
      }
      throw new AuthDependencyUnavailableError('workspaces', error);
    }
    if (error instanceof AuthDependencyUnavailableError) throw error;
    throw new AuthDependencyUnavailableError('workspaces', error);
  }
}

/** Re-checks live membership and workspace lifecycle through the owning module. */
export async function requireActiveAgentWorkspaceMembership(params: {
  userId: string;
  workspaceId: string;
  workspaces: WorkspacesInterModuleClient;
}): Promise<void> {
  const result = await currentAgentMemberships(params);
  assertActiveAgentMembershipSnapshot({
    workspaceId: params.workspaceId,
    memberships: result.memberships,
  });
  await assertActiveAgentMembership({...params, memberships: result.memberships});
}

export async function listAgentGrants(params: {userId: string}): Promise<AgentGrantSummary[]> {
  return await listAgentGrantSummaries(params);
}

export async function revokeAgentGrant(params: {
  userId: string;
  grantId: string;
}): Promise<AgentGrant> {
  const grant = await revokeAgentGrantForUser(params);
  if (!grant) throw new AgentGrantNotFoundError();
  return grant;
}

export async function createAgentPersonalAccessToken(
  params: CreateAgentPersonalAccessTokenParams & {workspaces: WorkspacesInterModuleClient},
): Promise<CreateAgentPersonalAccessTokenResult> {
  const expiresInDays = params.expiresInDays ?? 90;
  if (!isAgentPatExpiryDays(expiresInDays)) {
    throw new Error('Agent personal access token expiry must be 30, 90, or 365 days');
  }

  await requireActiveAgentWorkspaceMembership({
    userId: params.userId,
    workspaceId: params.workspaceId,
    workspaces: params.workspaces,
  });

  const token = generateOpaqueToken('personalAccessToken');
  const pat = await createAgentPersonalAccessTokenForActiveUser({
    userId: params.userId,
    workspaceId: params.workspaceId,
    hashedToken: hashOpaqueToken(token),
    prefix: extractDisplayPrefix(token),
    name: params.name,
    scopes: [OAUTH_READ_SCOPE],
    expiresAt: new Date(
      (params.now ?? new Date()).getTime() + expiresInDays * MILLISECONDS_PER_DAY,
    ),
  });
  if (!pat) throw new AgentAccessUserInactiveError();

  return {token, pat};
}

export async function listAgentPersonalAccessTokens(params: {
  userId: string;
}): Promise<AgentPersonalAccessTokenSummary[]> {
  return await listAgentPersonalAccessTokenSummaries(params);
}

export async function revokeAgentPersonalAccessToken(params: {
  userId: string;
  id: string;
}): Promise<AgentPersonalAccessToken> {
  const pat = await revokeAgentPersonalAccessTokenForUser(params);
  if (!pat) throw new AgentPersonalAccessTokenNotFoundError();
  return pat;
}
