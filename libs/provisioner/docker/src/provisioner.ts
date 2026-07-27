import {logger} from '@shipfox/node-opentelemetry';
import {startProvisioner} from '@shipfox/provisioner-core';
import {config, dockerExtraHosts, dockerLogDriver, dockerLogOptions} from '#config.js';
import {createDockerEngine, DockerEngineError} from '#docker-engine.js';
import {createDockerLifecycle, type DockerLifecycle} from '#lifecycle.js';
import {type DockerTemplateSpec, loadDockerTemplates} from '#templates.js';

/**
 * Start the Docker provisioner: load and validate the local Docker templates, then run
 * the provider-agnostic control loop against them with the configured launcher.
 */
export function startDockerProvisioner(): Promise<void> {
  const templates = loadDockerTemplates(config.SHIPFOX_PROVISIONER_TEMPLATES_FILE);
  const engine = createDockerEngine({
    ...(config.SHIPFOX_PROVISIONER_DOCKER_HOST
      ? {host: config.SHIPFOX_PROVISIONER_DOCKER_HOST}
      : {}),
    ...(config.SHIPFOX_PROVISIONER_DOCKER_NETWORK
      ? {network: config.SHIPFOX_PROVISIONER_DOCKER_NETWORK}
      : {}),
    ...(dockerExtraHosts ? {extraHosts: dockerExtraHosts} : {}),
    ...(dockerLogDriver ? {loggingDriver: dockerLogDriver} : {}),
    ...(dockerLogOptions ? {loggingOptions: dockerLogOptions} : {}),
  });
  let lifecycle: DockerLifecycle | undefined;
  let effectiveLoggingDriver = dockerLogDriver;
  const loggingDriverSource: 'daemon' | 'provisioner' = dockerLogDriver ? 'provisioner' : 'daemon';

  return startProvisioner<DockerTemplateSpec>({
    adapter: {
      loadTemplates: () => Promise.resolve(templates),
      async onConfigure() {
        if (!dockerLogDriver) {
          try {
            effectiveLoggingDriver = (await engine.getInfo()).loggingDriver;
          } catch (error) {
            logger().warn(
              {
                event: 'docker.logging_driver_discovery_deferred',
                operation: 'docker_info',
                reason: error instanceof DockerEngineError ? error.reason : 'unknown',
              },
              'Docker logging-driver discovery deferred until the daemon is available',
            );
          }
        }
        return {
          loggingDriver: effectiveLoggingDriver ?? 'daemon-default',
          loggingDriverSource,
          loggingDriverDiscovery: effectiveLoggingDriver ? 'detected' : 'deferred',
          loggingOptionNames: dockerLogOptions ? Object.keys(dockerLogOptions).sort() : [],
          failedContainerRetentionMs:
            config.SHIPFOX_PROVISIONER_DOCKER_FAILED_CONTAINER_RETENTION_MS,
          maxRetainedFailedContainers:
            config.SHIPFOX_PROVISIONER_DOCKER_MAX_RETAINED_FAILED_CONTAINERS,
        };
      },
      launch: (launch) => {
        if (!lifecycle) throw new Error('Docker lifecycle has not been initialized.');
        return lifecycle.launch(launch);
      },
      terminate: (ids) => {
        if (!lifecycle) throw new Error('Docker lifecycle has not been initialized.');
        return lifecycle.terminate(ids);
      },
      async onStart(runtime) {
        lifecycle = createDockerLifecycle({
          engine,
          client: runtime.client,
          identity: runtime.identity,
          tracker: runtime.tracker,
          templates,
          registrationDeadlineMs: config.SHIPFOX_PROVISIONER_REGISTRATION_DEADLINE_MS,
          providerKind: 'docker',
          failedContainerRetentionMs:
            config.SHIPFOX_PROVISIONER_DOCKER_FAILED_CONTAINER_RETENTION_MS,
          maxRetainedFailedContainers:
            config.SHIPFOX_PROVISIONER_DOCKER_MAX_RETAINED_FAILED_CONTAINERS,
          ...(effectiveLoggingDriver ? {loggingDriver: effectiveLoggingDriver} : {}),
          loggingDriverSource,
        });
        await lifecycle.reconcile();
      },
      async onTick() {
        if (!lifecycle) throw new Error('Docker lifecycle has not been initialized.');
        if (!dockerLogDriver && !effectiveLoggingDriver) {
          try {
            effectiveLoggingDriver = (await engine.getInfo()).loggingDriver;
            lifecycle.setLoggingDriver(effectiveLoggingDriver);
            logger().info(
              {
                event: 'docker.logging_driver_discovered',
                loggingDriver: effectiveLoggingDriver,
                loggingDriverSource: 'daemon',
              },
              'Docker logging driver discovered after startup',
            );
          } catch {
            // Observation below remains the recoverable source of truth for daemon health.
          }
        }
        return lifecycle.tick();
      },
      onStop() {
        return lifecycle?.flush() ?? Promise.resolve();
      },
    },
  });
}
