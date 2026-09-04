import {randomUUID} from 'node:crypto';
import {
  e2eDispatchListenerEventBodySchema,
  e2eDispatchListenerEventResponseSchema,
} from '@shipfox/api-triggers-dto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {ClientError, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {z} from 'zod';
import {dispatchIntegrationEvent} from '#core/dispatch-integration-event.js';
import {hasJobListenerSubscriptions} from '#db/job-listener-subscriptions.js';

const listenerReadinessParamsSchema = z.object({jobId: z.string().uuid()});
const listenerReadinessResponseSchema = z.object({ready: z.boolean()});

export interface TriggersE2eConnection {
  id: string;
  workspaceId: string;
  provider: string;
  slug: string;
  displayName: string;
  lifecycleStatus: 'active' | 'disabled' | 'error';
}

export type GetTriggersE2eConnection = (
  connectionId: string,
) => Promise<TriggersE2eConnection | undefined>;

const listenerReadinessRoute = defineRoute({
  method: 'GET',
  path: '/listeners/:jobId/readiness',
  description: 'Report whether trigger subscriptions for a listener job are ready in E2E tests.',
  schema: {
    params: listenerReadinessParamsSchema,
    response: {200: listenerReadinessResponseSchema},
  },
  handler: async (request) => ({
    ready: await hasJobListenerSubscriptions(request.params.jobId),
  }),
});

/**
 * This setup route intentionally calls the Triggers dispatcher directly so E2E can inject
 * payloads larger than public webhook ingress accepts. It is fire-once: integration outbox
 * persistence and replay are outside this payload-focused flow fixture.
 */
function createDispatchListenerEventRoute(params: {
  workflows: WorkflowsModuleClient;
  getIntegrationConnectionById: GetTriggersE2eConnection;
}) {
  return defineRoute({
    method: 'POST',
    path: '/listener-events',
    description: 'Dispatch a synthetic integration event to a listener in E2E tests.',
    options: {bodyLimit: 1_048_576},
    schema: {
      body: e2eDispatchListenerEventBodySchema,
      response: {202: e2eDispatchListenerEventResponseSchema},
    },
    handler: async (request, reply) => {
      const connection = await params.getIntegrationConnectionById(request.body.connection_id);
      if (!connection) {
        throw new ClientError(
          'Integration connection not found',
          'integration-connection-not-found',
          {
            status: 404,
          },
        );
      }
      if (connection.workspaceId !== request.body.workspace_id) {
        throw new ClientError(
          'Integration connection does not belong to the requested workspace',
          'forbidden',
          {status: 403},
        );
      }
      if (connection.lifecycleStatus !== 'active') {
        throw new ClientError(
          'Integration connection is not active',
          'integration-connection-inactive',
          {
            status: 422,
          },
        );
      }
      if (connection.slug !== request.body.source) {
        throw new ClientError(
          'Synthetic event source must match the integration connection slug',
          'integration-connection-source-mismatch',
          {status: 400},
        );
      }

      const eventRef = randomUUID();
      await dispatchIntegrationEvent({
        workflows: params.workflows,
        eventRef,
        origin: 'dev',
        workspaceId: connection.workspaceId,
        provider: connection.provider,
        source: connection.slug,
        event: request.body.event,
        deliveryId: request.body.delivery_id,
        connectionId: connection.id,
        connectionName: connection.displayName,
        payload: request.body.payload,
        receivedAt: new Date(),
      });
      reply.code(202);
      return {event_ref: eventRef, delivery_id: request.body.delivery_id};
    },
  });
}

export function createTriggersE2eRoutes(params: {
  workflows: WorkflowsModuleClient;
  getIntegrationConnectionById: GetTriggersE2eConnection;
}): RouteGroup {
  return {
    prefix: '/triggers',
    routes: [listenerReadinessRoute, createDispatchListenerEventRoute(params)],
  };
}
