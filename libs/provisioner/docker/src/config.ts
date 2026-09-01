import {createConfig, num, str} from '@shipfox/config';

export const config = createConfig({
  SHIPFOX_PROVISIONER_TEMPLATES_FILE: str({
    desc: 'Path to the YAML file describing the Docker runner templates this provisioner can start. Required. Each template lists its labels, cpu, memory, and max_concurrency, and may override the default runner image.',
  }),
  SHIPFOX_PROVISIONER_DOCKER_HOST: str({
    desc: 'Docker daemon host used by dockerode. Leave unset to use the local Docker socket, or set a Docker host URL when the daemon is remote.',
    default: undefined,
  }),
  SHIPFOX_PROVISIONER_DOCKER_NETWORK: str({
    desc: 'Docker network attached to runner containers. Set it when containers must join a Compose or bridge network to reach SHIPFOX_RUNNER_API_URL.',
    default: undefined,
  }),
  SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS: str({
    desc: 'Comma-separated host mappings added to runner containers, such as host.docker.internal:host-gateway. Set it when containers need Docker host names that are not available by default.',
    default: undefined,
  }),
  SHIPFOX_PROVISIONER_DOCKER_LOG_DRIVER: str({
    desc: 'Docker logging driver for runner containers. Leave unset to inherit the Docker daemon default. Built-in and installed plugin driver names are accepted.',
    default: undefined,
  }),
  SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS: str({
    desc: 'JSON object of Docker logging-driver options. Every value must be a string, and this setting requires SHIPFOX_PROVISIONER_DOCKER_LOG_DRIVER. Option values are never written to logs because they may contain credentials.',
    default: undefined,
  }),
  SHIPFOX_PROVISIONER_DOCKER_FAILED_CONTAINER_RETENTION_MS: num({
    desc: 'How long failed runner containers remain available for forensic inspection, in milliseconds. Defaults to one hour. Set 0 to disable failed-container retention.',
    default: 3_600_000,
  }),
  SHIPFOX_PROVISIONER_DOCKER_MAX_RETAINED_FAILED_CONTAINERS: num({
    desc: 'Maximum number of failed runner containers retained for forensic inspection. Defaults to 20. Set 0 to disable failed-container retention.',
    default: 20,
  }),
  SHIPFOX_PROVISIONER_REGISTRATION_DEADLINE_MS: num({
    desc: 'How long a created runner container may remain unstarted before the provisioner submits a registration-deadline candidate, in milliseconds. The API authorizes cleanup, and an unavailable API leaves the container in place for retry.',
    default: 120_000,
  }),
});

export const dockerExtraHosts = parseDockerExtraHosts(
  config.SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS,
);
export const dockerLogDriver = config.SHIPFOX_PROVISIONER_DOCKER_LOG_DRIVER?.trim() || undefined;
export const dockerLogOptions = parseDockerLogOptions(
  config.SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS,
  dockerLogDriver,
);

for (const [name, value] of [
  [
    'SHIPFOX_PROVISIONER_DOCKER_FAILED_CONTAINER_RETENTION_MS',
    config.SHIPFOX_PROVISIONER_DOCKER_FAILED_CONTAINER_RETENTION_MS,
  ],
  [
    'SHIPFOX_PROVISIONER_DOCKER_MAX_RETAINED_FAILED_CONTAINERS',
    config.SHIPFOX_PROVISIONER_DOCKER_MAX_RETAINED_FAILED_CONTAINERS,
  ],
] as const) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer; got ${value}.`);
  }
}

if (
  !Number.isInteger(config.SHIPFOX_PROVISIONER_REGISTRATION_DEADLINE_MS) ||
  config.SHIPFOX_PROVISIONER_REGISTRATION_DEADLINE_MS <= 0
) {
  throw new Error(
    `SHIPFOX_PROVISIONER_REGISTRATION_DEADLINE_MS must be a positive integer; got ${config.SHIPFOX_PROVISIONER_REGISTRATION_DEADLINE_MS}.`,
  );
}

function parseDockerExtraHosts(value: string | undefined): string[] | undefined {
  const hosts = value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return hosts && hosts.length > 0 ? hosts : undefined;
}

function parseDockerLogOptions(
  value: string | undefined,
  driver: string | undefined,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (driver === undefined) {
    throw new Error(
      'SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS requires SHIPFOX_PROVISIONER_DOCKER_LOG_DRIVER.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      'SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS must be valid JSON; the value was not logged because it may contain credentials.',
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      'SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS must be a JSON object with string values; arrays and null are not allowed.',
    );
  }

  for (const [key, optionValue] of Object.entries(parsed)) {
    if (typeof optionValue !== 'string') {
      throw new Error(
        `SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS must contain only string values; option "${key}" is ${typeof optionValue}.`,
      );
    }
  }

  return parsed as Readonly<Record<string, string>>;
}
