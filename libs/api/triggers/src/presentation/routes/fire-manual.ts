import {requireUserContext, requireWorkspaceResourceAccess} from '@shipfox/api-auth-context';
import {
  fireManualTriggerBodySchema,
  fireManualTriggerResponseSchema,
} from '@shipfox/api-triggers-dto';
import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {ManualTriggerNotFoundError} from '#core/errors.js';
import {fireManualSubscription} from '#core/fire-manual.js';
import {getManualSubscriptionByDefinitionId} from '#db/subscriptions.js';
import {mapStartRunError} from './map-start-run-error.js';

const startRunErrorDetailsSchema = z.union([
  z.object({definition_id: z.string()}),
  z.object({field: z.string(), source: z.string(), env_key: z.string().optional()}),
  z.object({labels: z.array(z.string())}),
]);

export function createFireManualTriggerRoute(workflows: WorkflowsModuleClient) {
  return defineRoute({
    method: 'POST',
    path: '/:definitionId/fire-manual',
    description: 'Fire the manual trigger of a workflow definition, creating a workflow run.',
    schema: {
      params: z.object({
        definitionId: z.string().uuid(),
      }),
      body: fireManualTriggerBodySchema,
      response: {
        201: fireManualTriggerResponseSchema,
        422: z.object({
          code: z.string(),
          details: startRunErrorDetailsSchema.optional(),
        }),
      },
    },
    errorHandler: (error) => {
      if (error instanceof ManualTriggerNotFoundError) {
        throw new ClientError(error.message, 'manual-trigger-not-found', {status: 404});
      }
      const clientError = mapStartRunError(
        error,
        workflowsInterModuleContract.methods.startRunFromTrigger,
      );
      if (clientError) throw clientError;
      throw error;
    },
    handler: async (request, reply) => {
      const {definitionId} = request.params;
      const userContext = requireUserContext(request);

      const subscription = await getManualSubscriptionByDefinitionId(definitionId);
      // Missing triggers and memberships remain 404 to avoid leaking existence; lifecycle claims
      // propagate their stable access errors.
      if (!subscription) {
        throw new ManualTriggerNotFoundError(definitionId);
      }
      requireWorkspaceResourceAccess({
        request,
        workspaceId: subscription.workspaceId,
        notFoundError: new ClientError('Manual trigger not found', 'manual-trigger-not-found', {
          status: 404,
        }),
      });

      const run = await fireManualSubscription({
        workflows,
        subscriptionId: subscription.id,
        callerWorkspaceId: subscription.workspaceId,
        userId: userContext.userId,
        inputs: request.body.inputs,
      });

      reply.status(201);
      return {workflow_run_id: run.id};
    },
  });
}
