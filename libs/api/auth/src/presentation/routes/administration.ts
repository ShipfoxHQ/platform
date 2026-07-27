import {AUTH_USER} from '@shipfox/api-auth-context';
import {
  administratorUserLookupQuerySchema,
  administratorUserSummarySchema,
  bootstrapAdminOwnerBodySchema,
  bootstrapAdminOwnerResponseSchema,
  grantAdminRoleBodySchema,
  grantAdminRoleResponseSchema,
  listAdminGrantsQuerySchema,
  listAdminGrantsResponseSchema,
  revokeAdminGrantBodySchema,
  revokeAdminGrantResponseSchema,
} from '@shipfox/api-auth-dto';
import {decodeTimestampIdCursor, encodeTimestampIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {requireAdminRole} from '#core/admin-role.js';
import {
  bootstrapFirstAdminOwner,
  findAdministratorUserSummary,
  grantAdministratorRole,
  listAdministratorGrantSummaries,
  revokeAdministratorGrant,
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
  InvalidAdminBootstrapTokenError,
  LastAdminOwnerError,
  UserNotFoundError,
} from '#core/errors.js';
import {getClientContext} from '#presentation/auth/jwt-auth.js';
import {createAuthIpRateLimitPreHandler} from './rate-limit.js';

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
    const user = lookupId
      ? await findAdministratorUserSummary({actorId, id: lookupId})
      : email
        ? await findAdministratorUserSummary({actorId, email})
        : undefined;
    if (!user) throw new UserNotFoundError(lookupId ?? email ?? 'unknown');
    return toAdministratorUserSummaryDto(user);
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

export const administrationRoutes: RouteGroup = {
  prefix: '/admin/auth/admin-grants',
  auth: AUTH_USER,
  routes: [bootstrapRoute, listRoute, grantRoute, revokeRoute],
};

export const administrationUserRoutes: RouteGroup = {
  prefix: '/admin/auth/users',
  auth: AUTH_USER,
  routes: [userLookupRoute],
};
