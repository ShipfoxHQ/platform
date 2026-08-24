import type {JobLeaseTokenClaims, RunnerSessionTokenClaims} from '@shipfox/api-auth-dto';
import type {WorkspaceRole} from '@shipfox/api-workspaces-dto';
import {ClientError} from '@shipfox/node-fastify';

export const AUTH_USER = 'user';
export const AUTH_RUNNER_REGISTRATION_TOKEN = 'runner-registration-token';
export const AUTH_RUNNER_SESSION = 'runner-session';
export const AUTH_RUNNER_CONTROL_SESSION = 'runner-control-session';
export const AUTH_LEASED_JOB = 'leased-job';
export const AUTH_PROVISIONER_TOKEN = 'provisioner-token';

export type WorkspaceStatus = 'active' | 'suspended' | 'deleted';

export interface UserContextMembership {
  workspaceId: string;
  role: WorkspaceRole;
  workspaceStatus: WorkspaceStatus;
}

export interface UserContext {
  userId: string;
  email: string;
  name: string | null;
  memberships: ReadonlyArray<UserContextMembership>;
  impersonatorId?: string | undefined;
  canAccess(workspaceId: string): boolean;
  hasRole(workspaceId: string, role: WorkspaceRole): boolean;
}

export interface BuildUserContextParams {
  userId: string;
  email: string;
  name?: string | null | undefined;
  memberships?: ReadonlyArray<UserContextMembership> | undefined;
  impersonatorId?: string | undefined;
}

export function buildUserContext(params: BuildUserContextParams): UserContext {
  const memberships = params.memberships ?? [];
  return {
    userId: params.userId,
    email: params.email,
    name: params.name ?? null,
    memberships,
    impersonatorId: params.impersonatorId,
    canAccess: (workspaceId) =>
      memberships.some((m) => m.workspaceId === workspaceId && m.workspaceStatus === 'active'),
    hasRole: (workspaceId, role) =>
      memberships.some(
        (m) => m.workspaceId === workspaceId && m.workspaceStatus === 'active' && m.role === role,
      ),
  };
}

export type ProvisionerContext =
  | {provisionerTokenId: string; scope: 'installation'}
  | {provisionerTokenId: string; scope: 'workspace'; workspaceId: string};

export type LeasedJobContext = JobLeaseTokenClaims;
export type RunnerSessionContext = RunnerSessionTokenClaims;
export interface RunnerControlSessionContext {
  runnerControlSessionId: string;
  runnerInstanceId: string;
  provisionerId: string;
}

type RequestWithContext = object;

const USER_CONTEXT_KEY = Symbol.for('@shipfox/api-auth-context/user');
const LEASED_JOB_CONTEXT_KEY = Symbol.for('@shipfox/api-auth-context/leased-job');
const PROVISIONER_CONTEXT_KEY = Symbol.for('@shipfox/api-auth-context/provisioner');
const RUNNER_SESSION_CONTEXT_KEY = Symbol.for('@shipfox/api-auth-context/runner-session');
const RUNNER_CONTROL_SESSION_CONTEXT_KEY = Symbol.for(
  '@shipfox/api-auth-context/runner-control-session',
);

export function setUserContext(request: RequestWithContext, context: UserContext): void {
  (request as Record<symbol, unknown>)[USER_CONTEXT_KEY] = context;
}

export function getUserContext(request: RequestWithContext): UserContext | null {
  return (
    ((request as Record<symbol, unknown>)[USER_CONTEXT_KEY] as UserContext | undefined) ?? null
  );
}

export function requireUserContext(request: RequestWithContext): UserContext {
  const context = getUserContext(request);
  if (!context) {
    throw new Error('User context is not available on this request');
  }
  return context;
}

export interface RequireWorkspaceAccessParams {
  request: RequestWithContext;
  workspaceId: string;
}

export interface RequireWorkspaceAccessResult {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

/**
 * Authorizes the request's user for a workspace using only the verified session
 * token. Membership and role come from the token claims, so the check stays
 * stateless and does not read the database on the request path.
 */
export function requireWorkspaceAccess(
  params: RequireWorkspaceAccessParams,
): RequireWorkspaceAccessResult {
  const context = getUserContext(params.request);
  if (!context) {
    throw new ClientError('Authentication required', 'unauthorized', {status: 401});
  }

  const membership = context.memberships.find((m) => m.workspaceId === params.workspaceId);
  if (!membership) {
    throw new ClientError('Not a member of this workspace', 'forbidden', {status: 403});
  }

  if (membership.workspaceStatus === 'suspended') {
    throw new ClientError('Workspace is suspended', 'workspace-suspended', {status: 409});
  }
  if (membership.workspaceStatus === 'deleted') {
    throw new ClientError('Workspace is not active', 'workspace-inactive', {status: 403});
  }

  return {workspaceId: params.workspaceId, userId: context.userId, role: membership.role};
}

/**
 * Applies the workspace lifecycle gate to a resource that has already been loaded. Missing
 * membership remains resource-shaped 404 to avoid leaking the resource's existence, while
 * suspended and deleted claims retain their stable lifecycle errors.
 */
export function requireWorkspaceResourceAccess(params: {
  request: RequestWithContext;
  workspaceId: string;
  notFoundError: ClientError;
}): RequireWorkspaceAccessResult {
  try {
    return requireWorkspaceAccess(params);
  } catch (error) {
    if (error instanceof ClientError && error.code === 'forbidden') {
      throw params.notFoundError;
    }
    throw error;
  }
}

export function setProvisionerContext(
  request: RequestWithContext,
  context: ProvisionerContext,
): void {
  (request as Record<symbol, unknown>)[PROVISIONER_CONTEXT_KEY] = context;
}

export function getProvisionerContext(request: RequestWithContext): ProvisionerContext | null {
  return (
    ((request as Record<symbol, unknown>)[PROVISIONER_CONTEXT_KEY] as
      | ProvisionerContext
      | undefined) ?? null
  );
}

export function requireProvisionerContext(request: RequestWithContext): ProvisionerContext {
  const context = getProvisionerContext(request);
  if (!context) {
    throw new Error('Provisioner context is not available on this request');
  }
  return context;
}

export function requireWorkspaceProvisionerContext(
  request: RequestWithContext,
): Extract<ProvisionerContext, {scope: 'workspace'}> {
  const context = requireProvisionerContext(request);
  if (context.scope !== 'workspace') {
    throw new ClientError('Workspace provisioner credential required', 'forbidden', {status: 403});
  }
  return context;
}

export function requireInstallationProvisionerContext(
  request: RequestWithContext,
): Extract<ProvisionerContext, {scope: 'installation'}> {
  const context = requireProvisionerContext(request);
  if (context.scope !== 'installation') {
    throw new ClientError('Installation provisioner credential required', 'forbidden', {
      status: 403,
    });
  }
  return context;
}

export function setLeasedJobContext(request: RequestWithContext, context: LeasedJobContext): void {
  (request as Record<symbol, unknown>)[LEASED_JOB_CONTEXT_KEY] = context;
}

export function getLeasedJobContext(request: RequestWithContext): LeasedJobContext | null {
  return (
    ((request as Record<symbol, unknown>)[LEASED_JOB_CONTEXT_KEY] as
      | LeasedJobContext
      | undefined) ?? null
  );
}

export function requireLeasedJobContext(request: RequestWithContext): LeasedJobContext {
  const context = getLeasedJobContext(request);
  if (!context) {
    throw new Error('Leased job context is not available on this request');
  }
  return context;
}

export function setRunnerSessionContext(
  request: RequestWithContext,
  context: RunnerSessionContext,
): void {
  (request as Record<symbol, unknown>)[RUNNER_SESSION_CONTEXT_KEY] = context;
}

export function getRunnerSessionContext(request: RequestWithContext): RunnerSessionContext | null {
  return (
    ((request as Record<symbol, unknown>)[RUNNER_SESSION_CONTEXT_KEY] as
      | RunnerSessionContext
      | undefined) ?? null
  );
}

export function requireRunnerSessionContext(request: RequestWithContext): RunnerSessionContext {
  const context = getRunnerSessionContext(request);
  if (!context) {
    throw new Error('Runner session context is not available on this request');
  }
  return context;
}

export function setRunnerControlSessionContext(
  request: RequestWithContext,
  context: RunnerControlSessionContext,
): void {
  (request as Record<symbol, unknown>)[RUNNER_CONTROL_SESSION_CONTEXT_KEY] = context;
}

export function requireRunnerControlSessionContext(
  request: RequestWithContext,
): RunnerControlSessionContext {
  const context = (request as Record<symbol, unknown>)[RUNNER_CONTROL_SESSION_CONTEXT_KEY] as
    | RunnerControlSessionContext
    | undefined;
  if (!context) throw new Error('Runner control session context is not available on this request');
  return context;
}
