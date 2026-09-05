import type {JobLeaseTokenClaims, RunnerSessionTokenClaims} from '@shipfox/api-auth-dto';
import type {WorkspaceRole} from '@shipfox/api-workspaces-dto';
import {
  ClientError,
  isRouteGroup,
  type RouteExport,
  type RoutePreHandler,
} from '@shipfox/node-fastify';

export {
  hasOAuthControlCharacter,
  InvalidOAuthPublicOriginError,
  isOAuthLoopbackHostname,
  normalizeOAuthPublicOrigin,
} from './oauth-public-origin.js';

export const AUTH_USER = 'user';
export const AUTH_RUNNER_REGISTRATION_TOKEN = 'runner-registration-token';
export const AUTH_RUNNER_SESSION = 'runner-session';
export const AUTH_RUNNER_CONTROL_SESSION = 'runner-control-session';
export const AUTH_LEASED_JOB = 'leased-job';
export const AUTH_PROVISIONER_TOKEN = 'provisioner-token';
export const AUTH_AGENT_ACCESS = 'agent-access';

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

export type AgentAccessScope = 'read';

export interface AgentAccessCredential {
  kind: 'oauth_grant';
  grantId: string;
  clientId: string;
}

/** The shared identity and authority resolved from an agent credential. */
export interface AgentAccessContext {
  userId: string;
  workspaceId: string;
  scopes: ReadonlyArray<AgentAccessScope>;
  credential: AgentAccessCredential;
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
const AGENT_ACCESS_CONTEXT_KEY = Symbol.for('@shipfox/api-auth-context/agent-access');

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

export function setAgentAccessContext(
  request: RequestWithContext,
  context: AgentAccessContext,
): void {
  (request as Record<symbol, unknown>)[AGENT_ACCESS_CONTEXT_KEY] = context;
}

export function getAgentAccessContext(request: RequestWithContext): AgentAccessContext | null {
  return (
    ((request as Record<symbol, unknown>)[AGENT_ACCESS_CONTEXT_KEY] as
      | AgentAccessContext
      | undefined) ?? null
  );
}

export function requireAgentAccessContext(request: RequestWithContext): AgentAccessContext {
  const context = getAgentAccessContext(request);
  if (!context) {
    throw new Error('Agent access context is not available on this request');
  }
  return context;
}

/**
 * Rejects a request whose user context carries an impersonator (the
 * durable-artefact deny-list). Routes that issue a credential or create a
 * durable grant call this so an impersonated session cannot leave anything
 * behind that outlives its bounded token window. Requires a user context:
 * callers must run it on routes whose auth method has set one.
 */
export function rejectImpersonatedSession(request: RequestWithContext): void {
  const context = requireUserContext(request);
  if (context.impersonatorId) {
    throw new ClientError(
      'Impersonated sessions cannot issue credentials or create durable grants',
      'impersonation-not-permitted',
      {status: 403},
    );
  }
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
 * Rejects an impersonated session before any administrator authority is
 * consulted. Every route under an `/admin` prefix runs this guard: a request
 * whose context carries `impersonatorId` receives the same `admin-role-required`
 * failure a role-less actor would, before roles are read, so a target that
 * gains a grant inside the token window still cannot act on it. The check is
 * request-scoped on purpose: the inter-module `requireAdminRole` contract only
 * carries `{userId, minimumRole}` and cannot transport the mark.
 */
export function requireAdministrationActor(request: RequestWithContext): void {
  const context = getUserContext(request);
  if (context?.impersonatorId != null) {
    throw new ClientError('Administrator role required', 'admin-role-required', {status: 403});
  }
}

const ADMINISTRATION_PREFIX = '/admin';
const TRAILING_SLASHES = /\/+$/;
const LEADING_SLASHES = /^\/+/;

function isAdministrationPrefix(prefix: string): boolean {
  return prefix === ADMINISTRATION_PREFIX || prefix.startsWith(`${ADMINISTRATION_PREFIX}/`);
}

/**
 * Joins a parent prefix and a child prefix or route path the way Fastify
 * resolves the mounted URL: surrounding slashes are trimmed and segments are
 * joined with a single `/`, and a leading slash is added when the joined path
 * is non-empty. Raw concatenation would diverge from Fastify's resolution for
 * slash-less prefixes (`/admin` + `things` -> `/adminthings` while Fastify
 * mounts `/admin/things`) and let a route escape the guard while still
 * mounting under `/admin`.
 */
function joinRoutePath(parent: string, child: string): string {
  if (parent === '') {
    return child.startsWith('/') ? child : `/${child}`;
  }
  if (child === '') {
    return parent;
  }
  return `${parent.replace(TRAILING_SLASHES, '')}/${child.replace(LEADING_SLASHES, '')}`;
}

function routePreHandlers(
  preHandler: RoutePreHandler | RoutePreHandler[] | undefined,
): RoutePreHandler[] {
  if (preHandler === undefined) return [];
  if (Array.isArray(preHandler)) return preHandler;
  return [preHandler];
}

function adoptAdministrationGuardIn(route: RouteExport, parentPrefix: string): RouteExport {
  if (isRouteGroup(route)) {
    return {
      ...route,
      routes: route.routes.map((child) =>
        adoptAdministrationGuardIn(child, joinRoutePath(parentPrefix, route.prefix)),
      ),
    };
  }
  const effectivePath = joinRoutePath(parentPrefix, route.path);
  if (!isAdministrationPrefix(parentPrefix) && !isAdministrationPrefix(effectivePath)) {
    return route;
  }
  const preHandler: RoutePreHandler[] = [
    (request) => {
      requireAdministrationActor(request);
      return undefined;
    },
    ...routePreHandlers(route.preHandler),
  ];
  return {...route, preHandler};
}

/**
 * Positionally adopts the impersonated-session rejection for every route under
 * an `/admin` prefix in the given route tree: the rule is "every `/admin`
 * route", so an administration surface added later under the prefix inherits
 * the guard without anyone remembering to attach it. The guard runs before any
 * existing preHandler, so roles are never consulted for an impersonated
 * context — including on role-check-free routes such as the first-owner
 * bootstrap.
 */
export function adoptAdministrationActorGuard<T extends RouteExport | RouteExport[]>(routes: T): T {
  if (Array.isArray(routes)) {
    return routes.map((route) => adoptAdministrationGuardIn(route, '')) as T;
  }
  return adoptAdministrationGuardIn(routes, '') as T;
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
