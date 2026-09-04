import {randomUUID} from 'node:crypto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {z} from 'zod';
import {dispatchIntegrationEvent} from '#core/dispatch-integration-event.js';
import {hasJobListenerSubscriptions} from '#db/job-listener-subscriptions.js';

const listenerReadinessParamsSchema = z.object({jobId: z.string().uuid()});
const listenerReadinessResponseSchema = z.object({ready: z.boolean()});
const dispatchListenerEventBodySchema = z.object({
  workspace_id: z.string().uuid(),
  connection_id: z.string().uuid(),
  source: z.string().min(1),
  event: z.string().min(1),
  delivery_id: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});
const dispatchListenerEventResponseSchema = z.object({
  event_ref: z.string().uuid(),
  delivery_id: z.string(),
});

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

function createDispatchListenerEventRoute(workflows: WorkflowsModuleClient) {
  return defineRoute({
    method: 'POST',
    path: '/listener-events',
    description: 'Dispatch a synthetic integration event to a listener in E2E tests.',
    options: {bodyLimit: 1_048_576},
    schema: {
      body: dispatchListenerEventBodySchema,
      response: {202: dispatchListenerEventResponseSchema},
    },
    handler: async (request, reply) => {
      const eventRef = randomUUID();
      await dispatchIntegrationEvent({
        workflows,
        eventRef,
        workspaceId: request.body.workspace_id,
        provider: 'webhook',
        source: request.body.source,
        event: request.body.event,
        deliveryId: request.body.delivery_id,
        connectionId: request.body.connection_id,
        connectionName: null,
        payload: request.body.payload,
        receivedAt: new Date(),
      });
      reply.code(202);
      return {event_ref: eventRef, delivery_id: request.body.delivery_id};
    },
  });
}

export function createTriggersE2eRoutes(workflows: WorkflowsModuleClient): RouteGroup {
  return {
    prefix: '/triggers',
    routes: [listenerReadinessRoute, createDispatchListenerEventRoute(workflows)],
  };
}
