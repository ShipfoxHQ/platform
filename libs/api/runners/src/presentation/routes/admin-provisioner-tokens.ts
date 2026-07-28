import {AUTH_USER, requireUserContext} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import {
  createAdministratorProvisionerTokenBodySchema,
  createAdministratorProvisionerTokenResponseSchema,
  listAdministratorProvisionerTokensQuerySchema,
  listAdministratorProvisionerTokensResponseSchema,
  revokeAdministratorProvisionerTokenBodySchema,
  revokeAdministratorProvisionerTokenResponseSchema,
} from '@shipfox/api-runners-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {decodeTimestampIdCursor, encodeTimestampIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  createAdministratorInstallationProvisionerToken,
  listAdministratorInstallationProvisionerTokens,
  ProvisionerAdminIdempotencyKeyReuseError,
  ProvisionerAdminIdempotencyReplayUnavailableError,
  ProvisionerTokenNotFoundError,
  revokeAdministratorInstallationProvisionerToken,
} from '#core/index.js';
import {toAdministratorProvisionerTokenDto} from '#presentation/dto/index.js';

const idempotencyKeyMaxLength = 256;

function requireIdempotencyKey(request: {headers: Record<string, string | string[] | undefined>}) {
  const value = request.headers['idempotency-key'];
  const key = Array.isArray(value) ? value[0] : value;
  if (!key || key.trim().length === 0 || key.length > idempotencyKeyMaxLength) {
    throw new ClientError('Idempotency-Key header is required', 'idempotency-key-required', {
      status: 400,
    });
  }
  return key;
}

function translateAdministrationError(error: unknown): never {
  if (
    isInterModuleKnownError(authInterModuleContract.methods.requireAdminRole, error) &&
    error.code === 'admin-role-required'
  ) {
    throw new ClientError('Administrator role required', 'forbidden', {
      status: 403,
      details: {required_role: error.details.requiredRole},
    });
  }
  if (error instanceof ProvisionerAdminIdempotencyKeyReuseError) {
    throw new ClientError(
      'Idempotency-Key was already used for a different provisioner token command',
      'idempotency-key-reused',
      {status: 409},
    );
  }
  if (error instanceof ProvisionerAdminIdempotencyReplayUnavailableError) {
    throw new ClientError(
      'Idempotency-Key replay cannot reproduce the original provisioner token',
      'idempotency-replay-unavailable',
      {status: 409},
    );
  }
  if (error instanceof ProvisionerTokenNotFoundError) {
    throw new ClientError('Installation provisioner token not found', 'not-found', {
      status: 404,
    });
  }
  throw error;
}

export function createAdminProvisionerTokenRoutes(
  auth: Pick<AuthInterModuleClient, 'requireAdminRole'>,
): RouteGroup {
  const listRoute = defineRoute({
    method: 'GET',
    path: '/',
    auth: AUTH_USER,
    description: 'List bounded installation provisioner token metadata for administrators.',
    schema: {
      querystring: listAdministratorProvisionerTokensQuerySchema,
      response: {200: listAdministratorProvisionerTokensResponseSchema},
    },
    errorHandler: translateAdministrationError,
    handler: async (request) => {
      const actor = requireUserContext(request);
      await auth.requireAdminRole({userId: actor.userId, minimumRole: 'admin-observer'});
      const {status, limit, cursor} = request.query;
      const decodedCursor = decodeTimestampIdCursor(cursor);
      if (cursor !== undefined && !decodedCursor) {
        throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
      }
      const result = await listAdministratorInstallationProvisionerTokens({
        status,
        limit,
        ...(decodedCursor ? {cursor: decodedCursor} : {}),
      });
      return {
        tokens: result.tokens.map(toAdministratorProvisionerTokenDto),
        next_cursor: result.nextCursor ? encodeTimestampIdCursor(result.nextCursor) : null,
      };
    },
  });

  const createRoute = defineRoute({
    method: 'POST',
    path: '/',
    auth: AUTH_USER,
    description: 'Create an installation-wide provisioner token for administrators.',
    schema: {
      body: createAdministratorProvisionerTokenBodySchema,
      response: {201: createAdministratorProvisionerTokenResponseSchema},
    },
    errorHandler: translateAdministrationError,
    handler: async (request, reply) => {
      const actor = requireUserContext(request);
      const role = await auth.requireAdminRole({
        userId: actor.userId,
        minimumRole: 'admin-owner',
      });
      const result = await createAdministratorInstallationProvisionerToken({
        actorId: actor.userId,
        actorRole: role.role,
        idempotencyKey: requireIdempotencyKey(request),
        correlationId: request.id,
        reason: request.body.reason,
        name: request.body.name,
        ttlSeconds: request.body.ttl_seconds,
      });
      reply.code(201);
      return {
        ...toAdministratorProvisionerTokenDto(result.token),
        raw_token: result.rawToken,
        correlation_id: result.correlationId,
      };
    },
  });

  const revokeRoute = defineRoute({
    method: 'POST',
    path: '/:tokenId/revoke',
    auth: AUTH_USER,
    description: 'Revoke an installation provisioner token and its unclaimed descendants.',
    schema: {
      params: z.object({tokenId: z.string().uuid()}),
      body: revokeAdministratorProvisionerTokenBodySchema,
      response: {200: revokeAdministratorProvisionerTokenResponseSchema},
    },
    errorHandler: translateAdministrationError,
    handler: async (request) => {
      const actor = requireUserContext(request);
      const role = await auth.requireAdminRole({
        userId: actor.userId,
        minimumRole: 'admin-operator',
      });
      const result = await revokeAdministratorInstallationProvisionerToken({
        actorId: actor.userId,
        actorRole: role.role,
        tokenId: request.params.tokenId,
        idempotencyKey: requireIdempotencyKey(request),
        correlationId: request.id,
        reason: request.body.reason,
      });
      return {
        ...toAdministratorProvisionerTokenDto(result.token),
        correlation_id: result.correlationId,
      };
    },
  });

  return {
    prefix: '/admin/runners/provisioner-tokens',
    auth: AUTH_USER,
    routes: [listRoute, createRoute, revokeRoute],
  };
}
