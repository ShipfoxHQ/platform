import {requireProvisionerContext} from '@shipfox/api-auth-context';
import {
  assignRunnerInstancesBodySchema,
  assignRunnerInstancesResponseSchema,
  RESERVATION_EXPIRED_ERROR_CODE,
  RUNNER_INSTANCE_NOT_ASSIGNABLE_ERROR_CODE,
} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {
  getRunnerAssignmentRejectionReason,
  ReservationExpiredError,
  ReservationNotFoundError,
  RunnerInstanceAlreadyAssignedError,
  RunnerInstanceNotAssignableError,
} from '#core/errors.js';
import {assignRunnerInstances} from '#core/runner-assignments.js';
import {recordProvisionedRunnerAssignmentRejected} from '#metrics/instance.js';

export const assignRunnerInstancesRoute = defineRoute({
  method: 'POST',
  path: '/runner-instances/assignments',
  description: 'Assign enrolled runner instances to an owned demand reservation',
  schema: {
    body: assignRunnerInstancesBodySchema,
    response: {200: assignRunnerInstancesResponseSchema},
  },
  errorHandler: (error) => {
    const rejectionReason = getRunnerAssignmentRejectionReason(error);
    if (rejectionReason)
      recordProvisionedRunnerAssignmentRejected({
        reason: rejectionReason,
        surface: 'provisioner',
      });
    if (error instanceof ReservationNotFoundError)
      throw new ClientError('Reservation not found', 'reservation-not-found', {status: 404});
    if (error instanceof ReservationExpiredError)
      throw new ClientError('Reservation has expired', RESERVATION_EXPIRED_ERROR_CODE, {
        status: 409,
      });
    if (
      error instanceof RunnerInstanceAlreadyAssignedError ||
      error instanceof RunnerInstanceNotAssignableError
    )
      throw new ClientError(
        'Runner instance cannot be assigned',
        RUNNER_INSTANCE_NOT_ASSIGNABLE_ERROR_CODE,
        {status: 409},
      );
    throw error;
  },
  handler: async (request) => {
    const {provisionerTokenId} = requireProvisionerContext(request);
    return {
      runner_instance_ids: await assignRunnerInstances({
        provisionerId: provisionerTokenId,
        reservationId: request.body.reservation_id,
        runnerInstanceIds: request.body.runner_instance_ids,
      }),
    };
  },
});
