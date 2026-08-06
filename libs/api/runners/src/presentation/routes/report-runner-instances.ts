import {requireProvisionerContext} from '@shipfox/api-auth-context';
import {
  reportRunnerInstancesBodySchema,
  reportRunnerInstancesResponseSchema,
} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {reportRunnerInstances} from '#core/index.js';
import {toReportRunnerInstancesResponseDto} from '#presentation/dto/index.js';

export const reportRunnerInstancesRoute = defineRoute({
  method: 'POST',
  path: '/runner-instances/report',
  description: 'Report provisioned runner lifecycle state',
  schema: {
    body: reportRunnerInstancesBodySchema,
    response: {
      200: reportRunnerInstancesResponseSchema,
    },
  },
  handler: async (request) => {
    const context = requireProvisionerContext(request);
    const result = await reportRunnerInstances({
      scope: context.scope,
      workspaceId: context.scope === 'workspace' ? context.workspaceId : null,
      provisionerId: context.provisionerTokenId,
      events: request.body.events.map((event) => ({
        providerRunnerId: event.provider_runner_id,
        reservationId: event.reservation_id ?? null,
        templateKey: event.template_key ?? null,
        labels: event.labels,
        state: event.state,
        reason: event.reason ?? null,
        runnerSessionId: event.runner_session_id ?? null,
        providerKind: event.provider_kind ?? null,
        reportedAt: new Date(event.reported_at),
      })),
    });

    return toReportRunnerInstancesResponseDto(result);
  },
});
