import {logger} from '@shipfox/node-opentelemetry';
import {startDockerProvisioner} from '@shipfox/provisioner-docker-provider';

try {
  await startDockerProvisioner();
} catch (error) {
  logger().error(
    {
      event: 'provisioner.fatal',
      reason: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      error,
    },
    'Fatal provisioner error',
  );
  process.exit(1);
}
