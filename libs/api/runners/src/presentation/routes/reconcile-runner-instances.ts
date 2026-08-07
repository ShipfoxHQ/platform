import {requireProvisionerContext} from '@shipfox/api-auth-context';
import {
  RECONCILE_RUNNER_INSTANCES_INTENDED_RESERVATION_HEADER,
  RECONCILE_RUNNER_INSTANCES_INTENDED_RESERVATION_HEADER_VALUE,
  reconcileRunnerInstancesBodySchema,
  reconcileRunnerInstancesResponseSchema,
} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {reconcileRunnerInstances} from '#core/index.js';
import {toReconcileRunnerInstancesResponseDto} from '#presentation/dto/index.js';

export const reconcileRunnerInstancesRoute = defineRoute({
  method: 'POST',
  path: '/runner-instances/reconcile',
  description: 'Reconcile provisioned runner state for a provisioner',
  schema: {
    body: reconcileRunnerInstancesBodySchema,
    response: {
      200: reconcileRunnerInstancesResponseSchema,
    },
  },
  handler: async (request) => {
    const context = requireProvisionerContext(request);
    const result = await reconcileRunnerInstances({
      workspaceId: context.scope === 'workspace' ? context.workspaceId : null,
      provisionerId: context.provisionerTokenId,
      observedRunnerInstanceIds: request.body.observed_provider_runner_ids,
    });

    return toReconcileRunnerInstancesResponseDto(result, {
      includeIntendedReservationId:
        request.headers[RECONCILE_RUNNER_INSTANCES_INTENDED_RESERVATION_HEADER] ===
        RECONCILE_RUNNER_INSTANCES_INTENDED_RESERVATION_HEADER_VALUE,
    });
  },
});
