import {requireUserContext} from '@shipfox/api-auth-context';
import {
  fireManualTriggerBodySchema,
  fireManualTriggerResponseSchema,
} from '@shipfox/api-triggers-dto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {ManualTriggerNotFoundError} from '#core/errors.js';
import {fireManualSubscription} from '#core/fire-manual.js';
import {
  isInterpolationUnresolvableError,
  isWorkspaceDeletedError,
  isWorkspaceNotFoundError,
  isWorkspaceSuspendedError,
} from '#core/workflows-client.js';
import {getManualSubscriptionByDefinitionId} from '#db/subscriptions.js';

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
          details: z.object({
            field: z.string(),
            source: z.string(),
            env_key: z.string().optional(),
          }),
        }),
      },
    },
    errorHandler: (error) => {
      if (error instanceof ManualTriggerNotFoundError) {
        throw new ClientError(error.message, 'manual-trigger-not-found', {status: 404});
      }
      if (isWorkspaceSuspendedError(error)) {
        throw new ClientError('Workspace is suspended', 'workspace-suspended', {
          status: 409,
          cause: error,
        });
      }
      if (isWorkspaceDeletedError(error)) {
        throw new ClientError('Workspace is deleted', 'workspace-deleted', {
          status: 404,
          cause: error,
        });
      }
      if (isWorkspaceNotFoundError(error)) {
        throw new ClientError('Workspace not found', 'workspace-not-found', {
          status: 404,
          cause: error,
        });
      }
      if (isInterpolationUnresolvableError(error)) {
        throw new ClientError(
          'Workflow interpolation cannot be resolved',
          'workflow-interpolation-unresolvable',
          {
            status: 422,
            details: {
              field: error.details.field,
              source: error.details.source,
              ...(error.details.envKey === undefined ? {} : {env_key: error.details.envKey}),
            },
          },
        );
      }
      throw error;
    },
    handler: async (request, reply) => {
      const {definitionId} = request.params;
      const userContext = requireUserContext(request);

      const subscription = await getManualSubscriptionByDefinitionId(definitionId);
      // 404 covers both "no such manual trigger" and "not your workspace" to avoid leaking existence.
      if (!subscription || !userContext.canAccess(subscription.workspaceId)) {
        throw new ManualTriggerNotFoundError(definitionId);
      }

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
