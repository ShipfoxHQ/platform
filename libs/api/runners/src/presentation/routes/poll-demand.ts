import {
  requireProvisionerContext,
  requireWorkspaceProvisionerContext,
} from '@shipfox/api-auth-context';
import type {PollDemandTemplateDto} from '@shipfox/api-runners-dto';
import {pollDemandBodySchema, pollDemandResponseSchema} from '@shipfox/api-runners-dto';
import {reportError} from '@shipfox/node-error-monitoring';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {pollDemand, releaseReservationGrants} from '#core/demand.js';
import {sanitizeRunnerLabels} from '#core/runner-labels.js';
import {publishWorkspaceProvisionerCapabilitySnapshot} from '#db/provisioner-capability-snapshots.js';
import {
  listQueuedDemandWorkspaceIds,
  pollInstallationDemandAndReserve,
  type ReservationGrant,
  type ReservationTemplate,
} from '#db/reservations.js';
import type {CreateRunnersModuleOptions} from '#installation-provisioning.js';
import {toPollDemandResponseDto} from '#presentation/dto/index.js';

const TERMINATE_INTENT_LIMIT = 1000;

function toReservationTemplates(
  templates: PollDemandTemplateDto[],
  scope: 'installation' | 'workspace',
): ReservationTemplate[] {
  return templates.map((template) => ({
    templateKey: template.template_key,
    labels: sanitizeRunnerLabels(template.labels, {
      scope,
      logLevel: 'debug',
      source: 'provisioner template advertisement',
    }),
    availableSlots: template.available_slots,
    starting: template.starting,
    running: template.running,
  }));
}

export function createPollDemandRoute(options: CreateRunnersModuleOptions = {}) {
  return defineRoute({
    method: 'POST',
    path: '/demand/poll',
    description: 'Poll aggregate runner demand and reserve capacity for a provisioner',
    schema: {
      body: pollDemandBodySchema,
      response: {
        200: pollDemandResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const abortController = new AbortController();
      let responseFinished = false;
      let responseReservations: ReservationGrant[] = [];
      reply.raw.on('finish', () => {
        responseFinished = true;
      });
      reply.raw.on('close', () => {
        if (!responseFinished) {
          abortController.abort();
          void releaseReservationGrants(responseReservations).catch((error) => {
            logger().error(
              {err: error, reservationCount: responseReservations.length},
              'Failed to release reservations after provisioner disconnect',
            );
            reportError(error, {
              boundary: 'runners.cleanup',
              operation: 'release-disconnected-reservations',
              extra: {reservationCount: responseReservations.length},
            });
          });
        }
      });
      const provisionerContext = requireProvisionerContext(request);
      const ttlSeconds = Math.min(
        request.body.reservation_ttl_seconds ?? config.RESERVATION_TTL_SECONDS,
        config.RESERVATION_TTL_MAX_SECONDS,
      );
      if (provisionerContext.scope === 'installation') {
        if (!options.installationProvisioning) {
          throw new ClientError(
            'Installation provisioner credentials are not accepted on this host',
            'forbidden',
            {
              status: 403,
            },
          );
        }
        const candidateWorkspaceIds = await listQueuedDemandWorkspaceIds();
        const eligibleWorkspaceIds =
          await options.installationProvisioning.policy.filterEligibleWorkspaceIds(
            candidateWorkspaceIds,
          );
        const templates = toReservationTemplates(request.body.templates, 'installation');
        const result = await pollInstallationDemandAndReserve({
          provisionerId: provisionerContext.provisionerTokenId,
          maxReservations: request.body.max_reservations,
          ttlSeconds,
          templates,
          capabilityWindowSeconds: config.PROVISIONER_ACTIVE_WINDOW_SECONDS,
          eligibleWorkspaceIds,
          signal: abortController.signal,
          onReservations: (reservations) => {
            responseReservations.push(...reservations);
          },
        });
        return toPollDemandResponseDto({
          ...result,
          terminateRunnerInstanceIds: [],
        });
      }
      const {provisionerTokenId, workspaceId} = requireWorkspaceProvisionerContext(request);

      const templates = toReservationTemplates(request.body.templates, 'workspace');
      await publishWorkspaceProvisionerCapabilitySnapshot({
        workspaceId,
        provisionerId: provisionerTokenId,
        templates,
      });

      const result = await pollDemand({
        workspaceId,
        provisionerId: provisionerTokenId,
        maxReservations: request.body.max_reservations,
        waitSeconds: request.body.wait_seconds,
        ttlSeconds,
        terminateIntentLimit: TERMINATE_INTENT_LIMIT,
        templates,
        signal: abortController.signal,
      });
      responseReservations = result.reservations;

      return toPollDemandResponseDto(result);
    },
  });
}

export const pollDemandRoute = createPollDemandRoute();
