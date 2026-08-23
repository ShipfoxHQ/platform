import {AUTH_USER, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  ConnectionSlugConflictError,
  type CreateIntegrationConnectionFn,
  type DeleteIntegrationConnectionFn,
  type GetIntegrationConnectionByIdFn,
  type IntegrationConnection,
  type UpdateIntegrationConnectionLifecycleStatusFn,
} from '@shipfox/api-integration-spi';
import {
  createWebhookConnectionBodySchema,
  listWebhookConnectionsQuerySchema,
  listWebhookConnectionsResponseSchema,
  updateWebhookConnectionBodySchema,
  WEBHOOK_PROVIDER,
  webhookConnectionDtoSchema,
} from '@shipfox/api-integration-webhook-dto';
import {ClientError, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {toWebhookConnectionDto} from '#presentation/dto/connections.js';

export interface CreateWebhookConnectionRoutesOptions {
  baseUrl: string;
  createIntegrationConnection: CreateIntegrationConnectionFn;
  listIntegrationConnections: (params: {workspaceId: string}) => Promise<IntegrationConnection[]>;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  updateIntegrationConnectionLifecycleStatus: UpdateIntegrationConnectionLifecycleStatusFn;
  deleteIntegrationConnection: DeleteIntegrationConnectionFn;
}

const connectionParamsSchema = z.object({
  connectionId: z.string().uuid(),
});

function isConnectionAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as {name?: unknown}).name === 'IntegrationConnectionAlreadyExistsError' ||
      error instanceof ConnectionSlugConflictError)
  );
}

async function requireWebhookConnection(params: {
  request: FastifyRequest;
  connectionId: string;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}): Promise<IntegrationConnection> {
  const connection = await params.getIntegrationConnectionById(params.connectionId);
  if (!connection || connection.provider !== WEBHOOK_PROVIDER) {
    throw new ClientError('Webhook connection not found', 'not-found', {status: 404});
  }

  requireWorkspaceAccess({request: params.request, workspaceId: connection.workspaceId});
  return connection;
}

export function createWebhookConnectionRoutes(
  options: CreateWebhookConnectionRoutesOptions,
): RouteGroup {
  const createConnectionRoute = defineRoute({
    method: 'POST',
    path: '/connections',
    auth: AUTH_USER,
    description: 'Create a generic webhook connection.',
    schema: {
      body: createWebhookConnectionBodySchema,
      response: {
        201: webhookConnectionDtoSchema,
      },
    },
    errorHandler: (error) => {
      if (isConnectionAlreadyExistsError(error)) {
        throw new ClientError('Webhook slug already exists', 'slug-already-exists', {status: 409});
      }
      throw error;
    },
    handler: async (request, reply) => {
      const {workspace_id: workspaceId, name, slug} = request.body;

      requireWorkspaceAccess({request, workspaceId});
      const connection = await options.createIntegrationConnection({
        workspaceId,
        provider: WEBHOOK_PROVIDER,
        // The generic webhook provider uses the human slug as its provider-side account id.
        externalAccountId: slug,
        slug,
        displayName: name,
      });

      reply.status(201);
      return toWebhookConnectionDto(connection, options.baseUrl);
    },
  });

  const listConnectionsRoute = defineRoute({
    method: 'GET',
    path: '/connections',
    auth: AUTH_USER,
    description: 'List generic webhook connections for a workspace.',
    schema: {
      querystring: listWebhookConnectionsQuerySchema,
      response: {
        200: listWebhookConnectionsResponseSchema,
      },
    },
    handler: async (request) => {
      const {workspace_id: workspaceId} = request.query;

      requireWorkspaceAccess({request, workspaceId});
      const connections = (await options.listIntegrationConnections({workspaceId})).filter(
        (connection) => connection.provider === WEBHOOK_PROVIDER,
      );
      return {
        connections: connections.map((connection) =>
          toWebhookConnectionDto(connection, options.baseUrl),
        ),
      };
    },
  });

  const updateConnectionRoute = defineRoute({
    method: 'PATCH',
    path: '/connections/:connectionId',
    auth: AUTH_USER,
    description: 'Update a generic webhook connection.',
    schema: {
      params: connectionParamsSchema,
      body: updateWebhookConnectionBodySchema,
      response: {
        200: webhookConnectionDtoSchema,
      },
    },
    handler: async (request) => {
      const connection = await requireWebhookConnection({
        request,
        connectionId: request.params.connectionId,
        getIntegrationConnectionById: options.getIntegrationConnectionById,
      });
      const updated = await options.updateIntegrationConnectionLifecycleStatus({
        id: connection.id,
        lifecycleStatus: request.body.lifecycle_status,
      });
      if (!updated) {
        throw new ClientError('Webhook connection not found', 'not-found', {status: 404});
      }
      return toWebhookConnectionDto(updated, options.baseUrl);
    },
  });

  const deleteConnectionRoute = defineRoute({
    method: 'DELETE',
    path: '/connections/:connectionId',
    auth: AUTH_USER,
    description: 'Delete a generic webhook connection.',
    schema: {
      params: connectionParamsSchema,
      response: {
        204: z.void(),
      },
    },
    handler: async (request, reply) => {
      const connection = await requireWebhookConnection({
        request,
        connectionId: request.params.connectionId,
        getIntegrationConnectionById: options.getIntegrationConnectionById,
      });

      await options.deleteIntegrationConnection({id: connection.id});
      reply.code(204);
    },
  });

  return {
    prefix: '/integrations/webhook',
    routes: [
      createConnectionRoute,
      listConnectionsRoute,
      updateConnectionRoute,
      deleteConnectionRoute,
    ],
  };
}
