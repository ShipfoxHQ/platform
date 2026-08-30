import {randomUUID} from 'node:crypto';
import {
  AUTH_USER,
  adoptAdministrationActorGuard,
  requireAdministrationActor,
} from '@shipfox/api-auth-context';
import {
  adminBootstrapStateSchema,
  administratorUserLookupQuerySchema,
  administratorUserMutationResponseSchema,
  administratorUserSummarySchema,
  bootstrapAdminOwnerBodySchema,
  bootstrapAdminOwnerResponseSchema,
  grantAdminRoleBodySchema,
  grantAdminRoleResponseSchema,
  impersonateResponseSchema,
  impersonateUserBodySchema,
  listAdminGrantsQuerySchema,
  listAdminGrantsResponseSchema,
  reactivateAdministratorUserBodySchema,
  revokeAdminGrantBodySchema,
  revokeAdminGrantResponseSchema,
  revokeAdministratorUserSessionsBodySchema,
  revokeAdministratorUserSessionsResponseSchema,
  suspendAdministratorUserBodySchema,
} from '@shipfox/api-auth-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {decodeTimestampIdCursor, encodeTimestampIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {requireAdminRole} from '#core/admin-role.js';
import {
  bootstrapFirstAdminOwner,
  findAdministratorUserSummary,
  getAdminBootstrapState,
  grantAdministratorRole,
  impersonateUser,
  listAdministratorGrantSummaries,
  reactivateAdministratorUser,
  revokeAdministratorGrant,
  revokeAdministratorUserSessions,
  suspendAdministratorUser,
} from '#core/administration.js';
import type {AdminGrant} from '#core/entities/admin-grant.js';
import type {
  AdministratorGrantSummary,
  AdministratorUserSummary,
} from '#core/entities/administrator-read-model.js';
import {
  AdminBootstrapClosedError,
  AdminGrantAlreadyExistsError,
  AdminGrantNotFoundError,
  AdminIdempotencyKeyReuseError,
  AdminRoleRequiredError,
  CannotImpersonateAdministratorError,
  CannotImpersonateSelfError,
  EmailNotVerifiedError,
  ImpersonationDisabledError,
  ImpersonationExpiredError,
  ImpersonationTargetNotActiveError,
  InvalidAdminBootstrapTokenError,
  InvalidCredentialsError,
  LastAdminOwnerError,
  UserNotFoundError,
} from '#core/errors.js';
import {getClientContext} from '#presentation/auth/jwt-auth.js';
import {toUserDto} from '#presentation/dto/user.js';
import {createAuthActorRateLimitPreHandler, createAuthIpRateLimitPreHandler} from './rate-limit.js';

const idempotencyKeyMaxLength = 256;

function requireActorId(request: FastifyRequest): string {
  const client = getClientContext(request);
  if (!client) {
    throw new ClientError('Authentication required', 'unauthorized', {status: 401});
  }
  return client.userId;
}

function requireIdempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  const key = Array.isArray(value) ? value[0] : value;
  if (!key || key.trim().length === 0 || key.length > idempotencyKeyMaxLength) {
    throw new ClientError('Idempotency-Key header is required', 'idempotency-key-required', {
      status: 400,
    });
  }
  return key;
}

async function requireAdministratorObserver(request: FastifyRequest): Promise<void> {
  await requireAdminRole({userId: requireActorId(request), minimumRole: 'admin-observer'});
}

function toAdminGrantDto(grant: AdminGrant) {
  return {
    id: grant.id,
    user_id: grant.userId,
    role: grant.role,
    revoked_at: grant.revokedAt?.toISOString() ?? null,
    created_at: grant.createdAt.toISOString(),
    updated_at: grant.updatedAt.toISOString(),
  };
}

function toAdministratorUserSummaryDto(user: AdministratorUserSummary) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    email_verified_at: user.emailVerifiedAt?.toISOString() ?? null,
    created_at: user.createdAt.toISOString(),
    admin_role: user.adminRole,
  };
}

function toAdministratorGrantSummaryDto(grant: AdministratorGrantSummary) {
  return {
    grant_id: grant.grantId,
    role: grant.role,
    created_at: grant.createdAt.toISOString(),
    revoked_at: grant.revokedAt?.toISOString() ?? null,
    user: grant.user,
  };
}

function toAdministratorUserMutationDto(result: {
  user: AdministratorUserSummary;
  correlationId: string;
}) {
  return {
    ...toAdministratorUserSummaryDto(result.user),
    correlation_id: result.correlationId,
  };
}

function translateAdministrationError(error: unknown): never {
  if (error instanceof AdminRoleRequiredError) {
    throw new ClientError('Administrator role required', 'forbidden', {
      status: 403,
      details: {required_role: error.minimumRole},
    });
  }
  if (error instanceof InvalidAdminBootstrapTokenError) {
    throw new ClientError('Bootstrap token is invalid', 'bootstrap-token-invalid', {
      status: 403,
    });
  }
  if (error instanceof AdminBootstrapClosedError) {
    throw new ClientError('First administrator owner already exists', 'bootstrap-closed', {
      status: 409,
    });
  }
  if (error instanceof AdminGrantAlreadyExistsError) {
    throw new ClientError('Administrator grant already exists', 'grant-already-exists', {
      status: 409,
    });
  }
  if (error instanceof AdminGrantNotFoundError) {
    throw new ClientError('Administrator grant not found', 'not-found', {status: 404});
  }
  if (error instanceof UserNotFoundError) {
    throw new ClientError('User not found', 'not-found', {status: 404});
  }
  if (error instanceof LastAdminOwnerError) {
    throw new ClientError('Cannot remove the final active administrator owner', 'last-owner', {
      status: 409,
    });
  }
  if (error instanceof AdminIdempotencyKeyReuseError) {
    throw new ClientError(
      'Idempotency-Key was already used for a different command',
      'idempotency-key-reused',
      {status: 409},
    );
  }
  if (error instanceof ImpersonationDisabledError) {
    throw new ClientError('Impersonation is disabled', 'impersonation-disabled', {status: 403});
  }
  if (error instanceof CannotImpersonateSelfError) {
    throw new ClientError('Cannot impersonate yourself', 'cannot-impersonate-self', {
      status: 403,
    });
  }
  if (error instanceof CannotImpersonateAdministratorError) {
    throw new ClientError(
      'Cannot impersonate an administrator',
      'cannot-impersonate-administrator',
      {status: 403},
    );
  }
  if (error instanceof ImpersonationTargetNotActiveError) {
    throw new ClientError('User cannot be impersonated', 'impersonation-target-not-active', {
      status: 403,
    });
  }
  // The mint primitive re-checks login eligibility (active, verified) on the
  // row it reads, and a concurrent suspension or unverification between the
  // in-transaction ladder read and that read surfaces these errors. Map them
  // to the same documented client error instead of a generic 500.
  if (error instanceof EmailNotVerifiedError || error instanceof InvalidCredentialsError) {
    throw new ClientError('User cannot be impersonated', 'impersonation-target-not-active', {
      status: 403,
    });
  }
  if (error instanceof ImpersonationExpiredError) {
    throw new ClientError('Impersonation session has expired', 'impersonation-expired', {
      status: 410,
    });
  }
  throw error;
}

const bootstrapRoute = defineRoute({
  method: 'POST',
  path: '/bootstrap',
  description: 'Claim the first administrator owner role with the deployment bootstrap token.',
  schema: {
    body: bootstrapAdminOwnerBodySchema,
    response: {201: bootstrapAdminOwnerResponseSchema},
  },
  preHandler: createAuthIpRateLimitPreHandler('bootstrap'),
  errorHandler: translateAdministrationError,
  handler: async (request, reply) => {
    const actorId = requireActorId(request);
    const grant = await bootstrapFirstAdminOwner({
      actorId,
      bootstrapToken: request.body.bootstrap_token,
      idempotencyKey: requireIdempotencyKey(request),
      correlationId: request.id,
    });
    reply.code(201);
    return toAdminGrantDto(grant);
  },
});

const bootstrapStateRoute = defineRoute({
  method: 'GET',
  path: '/bootstrap-state',
  description: 'Read whether first administrator owner bootstrap is available.',
  schema: {response: {200: adminBootstrapStateSchema}},
  preHandler: createAuthIpRateLimitPreHandler('bootstrap-state'),
  errorHandler: translateAdministrationError,
  handler: async () => ({state: await getAdminBootstrapState()}),
});

const listRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'List bounded local administrator grant summaries.',
  schema: {
    querystring: listAdminGrantsQuerySchema,
    response: {200: listAdminGrantsResponseSchema},
  },
  errorHandler: translateAdministrationError,
  handler: async (request) => {
    const {limit, cursor} = request.query;
    const decodedCursor = decodeTimestampIdCursor(cursor);
    if (cursor && !decodedCursor) {
      throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
    }

    const result = await listAdministratorGrantSummaries({
      actorId: requireActorId(request),
      limit,
      ...(decodedCursor ? {cursor: decodedCursor} : {}),
    });
    return {
      grants: result.grants.map(toAdministratorGrantSummaryDto),
      next_cursor: result.nextCursor ? encodeTimestampIdCursor(result.nextCursor) : null,
    };
  },
});

const userLookupRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'Find one administrator-safe user summary by exact ID or email.',
  schema: {
    querystring: administratorUserLookupQuerySchema,
    response: {200: administratorUserSummarySchema},
  },
  preHandler: [requireAdministratorObserver, createAuthIpRateLimitPreHandler('lookup')],
  errorHandler: translateAdministrationError,
  handler: async (request) => {
    const {id, user_id: userId, email} = request.query;
    const lookupId = id ?? userId;
    const actorId = requireActorId(request);
    let user: Awaited<ReturnType<typeof findAdministratorUserSummary>>;
    if (lookupId) user = await findAdministratorUserSummary({actorId, id: lookupId});
    else if (email) user = await findAdministratorUserSummary({actorId, email});
    if (!user) throw new UserNotFoundError(lookupId ?? email ?? 'unknown');
    return toAdministratorUserSummaryDto(user);
  },
});

const suspendUserRoute = defineRoute({
  method: 'POST',
  path: '/:userId/suspend',
  description: 'Suspend a user and revoke all of its active sessions.',
  schema: {
    params: z.object({userId: z.string().uuid()}),
    body: suspendAdministratorUserBodySchema,
    response: {200: administratorUserMutationResponseSchema},
  },
  errorHandler: translateAdministrationError,
  handler: async (request) => {
    const result = await suspendAdministratorUser({
      actorId: requireActorId(request),
      userId: request.params.userId,
      reason: request.body.reason,
      idempotencyKey: requireIdempotencyKey(request),
      correlationId: request.id,
    });
    return toAdministratorUserMutationDto(result);
  },
});

const reactivateUserRoute = defineRoute({
  method: 'POST',
  path: '/:userId/reactivate',
  description: 'Reactivate a suspended user without restoring revoked sessions.',
  schema: {
    params: z.object({userId: z.string().uuid()}),
    body: reactivateAdministratorUserBodySchema,
    response: {200: administratorUserMutationResponseSchema},
  },
  errorHandler: translateAdministrationError,
  handler: async (request) => {
    const result = await reactivateAdministratorUser({
      actorId: requireActorId(request),
      userId: request.params.userId,
      ...(request.body.reason ? {reason: request.body.reason} : {}),
      idempotencyKey: requireIdempotencyKey(request),
      correlationId: request.id,
    });
    return toAdministratorUserMutationDto(result);
  },
});

const revokeUserSessionsRoute = defineRoute({
  method: 'POST',
  path: '/:userId/revoke-sessions',
  description: 'Revoke all active sessions for a user without changing account status.',
  schema: {
    params: z.object({userId: z.string().uuid()}),
    body: revokeAdministratorUserSessionsBodySchema,
    response: {200: revokeAdministratorUserSessionsResponseSchema},
  },
  errorHandler: translateAdministrationError,
  handler: async (request) => {
    const result = await revokeAdministratorUserSessions({
      actorId: requireActorId(request),
      userId: request.params.userId,
      ...(request.body.reason ? {reason: request.body.reason} : {}),
      idempotencyKey: requireIdempotencyKey(request),
      correlationId: request.id,
    });
    return {
      ...toAdministratorUserMutationDto(result),
      sessions_revoked: result.sessionsRevoked,
    };
  },
});

const grantRoute = defineRoute({
  method: 'POST',
  path: '/',
  description: 'Grant a local administrator role to an active user.',
  schema: {
    body: grantAdminRoleBodySchema,
    response: {201: grantAdminRoleResponseSchema},
  },
  errorHandler: translateAdministrationError,
  handler: async (request, reply) => {
    const actorId = requireActorId(request);
    const grant = await grantAdministratorRole({
      actorId,
      userId: request.body.user_id,
      role: request.body.role,
      reason: request.body.reason,
      idempotencyKey: requireIdempotencyKey(request),
      correlationId: request.id,
    });
    reply.code(201);
    return toAdminGrantDto(grant);
  },
});

const revokeRoute = defineRoute({
  method: 'DELETE',
  path: '/:grantId',
  description: 'Revoke a local administrator grant.',
  schema: {
    params: z.object({grantId: z.string().uuid()}),
    body: revokeAdminGrantBodySchema,
    response: {200: revokeAdminGrantResponseSchema},
  },
  errorHandler: translateAdministrationError,
  handler: async (request) => {
    const grant = await revokeAdministratorGrant({
      actorId: requireActorId(request),
      grantId: request.params.grantId,
      reason: request.body.reason,
      idempotencyKey: requireIdempotencyKey(request),
      correlationId: request.id,
    });
    return toAdminGrantDto(grant);
  },
});

export const administrationRoutes: RouteGroup = adoptAdministrationActorGuard({
  prefix: '/admin/auth/admin-grants',
  auth: AUTH_USER,
  routes: [bootstrapRoute, listRoute, grantRoute, revokeRoute],
});

export const administrationBootstrapRoutes: RouteGroup = adoptAdministrationActorGuard({
  prefix: '/admin/auth',
  auth: AUTH_USER,
  routes: [bootstrapStateRoute],
});

function createImpersonateUserRoute(workspaces: WorkspacesInterModuleClient) {
  return defineRoute({
    method: 'POST',
    path: '/:userId/impersonate',
    description:
      'Mint a short-lived, marked, audited impersonated session for an active, verified, non-administrator user.',
    schema: {
      params: z.object({userId: z.string().uuid()}),
      body: impersonateUserBodySchema,
      response: {200: impersonateResponseSchema},
    },
    // The limiter runs ahead of the impersonated-session rejection: a request
    // carrying an already-issued impersonated token must consume the
    // `impersonate` IP and actor buckets instead of being rejected by the
    // guard first, or marked-session probes would bypass the limiter entirely.
    // The guard still runs before the authorization inside the command.
    preHandler: [
      createAuthActorRateLimitPreHandler('impersonate'),
      (request) => {
        requireAdministrationActor(request);
        return undefined;
      },
    ],
    errorHandler: translateAdministrationError,
    handler: async (request) => {
      const client = getClientContext(request);
      const result = await impersonateUser({
        actorId: requireActorId(request),
        ...(client?.impersonatorId ? {actorImpersonatorId: client.impersonatorId} : {}),
        targetUserId: request.params.userId,
        reason: request.body.reason,
        idempotencyKey: requireIdempotencyKey(request),
        // Fastify's default request IDs are process-local counters that reset
        // after a redeploy, so a replay could collide with an earlier mint's
        // ID and suppress the required failure event in the ambiguous-COMMIT
        // reconciliation. The correlation is a fresh process-independent UUID
        // per invocation.
        correlationId: randomUUID(),
        workspaces,
      });
      // `server_time` is the issuer's clock at response time: the banner
      // derives its countdown and Extend availability from this anchor.
      return {
        token: result.token,
        expires_at: result.expiresAt.toISOString(),
        server_time: new Date().toISOString(),
        impersonator_id: result.impersonatorId,
        user: toUserDto(result.user),
      };
    },
  });
}

export function createAdministrationUserRoutes(
  workspaces: WorkspacesInterModuleClient,
): RouteGroup[] {
  return [
    adoptAdministrationActorGuard({
      prefix: '/admin/auth/users',
      auth: AUTH_USER,
      routes: [userLookupRoute, suspendUserRoute, reactivateUserRoute, revokeUserSessionsRoute],
    }),
    // The impersonate route mounts outside the adopted guard on purpose: its
    // limiter must run before the impersonated-session rejection (see
    // `createImpersonateUserRoute`), so the guard is applied positionally
    // there. Every other route under `/admin/auth/users` keeps the adoption.
    {
      prefix: '/admin/auth/users',
      auth: AUTH_USER,
      routes: [createImpersonateUserRoute(workspaces)],
    },
  ];
}
