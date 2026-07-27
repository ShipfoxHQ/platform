import {logger} from '@shipfox/node-opentelemetry';
import type {LaunchRunner} from '#types.js';

/**
 * Records planned runners without provider side effects. The registration token and
 * injected env are secrets, so only non-sensitive identity is logged.
 */
export const loggingLaunch: LaunchRunner = (launch) => {
  logger().info(
    {
      event: 'runner.launch_planned',
      providerRunnerId: launch.providerRunnerId,
      reservationId: launch.reservationId,
      templateKey: launch.template.key,
      labels: launch.template.labels,
    },
    'Planned provisioned runner (logging launcher)',
  );
  return Promise.resolve({containerStarted: true, identityAttached: true, reported: true});
};
