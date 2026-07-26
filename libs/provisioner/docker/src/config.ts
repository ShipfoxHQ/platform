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
  SHIPFOX_PROVISIONER_REGISTRATION_DEADLINE_MS: num({
    desc: 'How long a created runner container may remain unstarted before the provisioner reaps it as a stale pre-run resource, in milliseconds.',
    default: 120_000,
  }),
});

export const dockerExtraHosts = parseDockerExtraHosts(
  config.SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS,
);

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
