# @shipfox/provisioner-docker-provider

The Docker provider for the Shipfox provisioner. It supplies the Docker-specific
configuration and launcher that [`@shipfox/provisioner-core`](../core) drives, and is
wired into the runnable [`@shipfox/provisioner-docker`](../../../apps/provisioner-docker)
app.

## Public API

- `startDockerProvisioner()`: load the local Docker templates and run the control
  loop against them.
- `loadDockerTemplates(filePath)`: read, parse, and validate the template YAML,
  returning provider-agnostic `ProvisionerTemplate`s with a `DockerTemplateSpec`.
- `DockerTemplateSpec`: the Docker launch details (`image`, `cpu`, `memory`).
- `DockerTemplateConfigError`: thrown on any config problem.

## Template config

The template file is YAML keyed by template name:

```yaml
templates:
  docker-ubuntu22-2vcpu:
    labels: [ubuntu22, ubuntu22-2vcpu]
    cpu: 2
    memory: 4GiB
    max_concurrency: 100
```

Loading fails fast with a clear, file-scoped error on a missing file, malformed YAML,
an invalid or unknown field, an unusable label, or an empty template set. Labels are
canonicalized (trim, lowercase, dedupe, sort) with the shared runner-label rules.
The optional `cost` field controls template selection; when it is omitted, the vCPU
count is used. Lower costs win when several templates satisfy the same generic label.

## Current behavior

This package loads and validates Docker template configuration, joins the shared
provisioner control loop, and starts one Docker container per reserved runner. Each
container is named by its `provider_runner_id` and carries `shipfox.*` labels so a
restarted provisioner can rebuild local capacity from Docker state.

The provider reports lifecycle through the API:

- `starting` before container creation.
- `running` on every observation cycle for running containers.
- `stopped` after successful exits, which are removed immediately; failed exits
  are retained for forensic inspection when retention is enabled.
- `terminated` for dead/removing containers and stale pre-run `created` containers.

At startup and at the top of every control-loop iteration, the provider lists local
containers owned by the provisioner token and refreshes tracker capacity before demand
polling. If Docker cannot be observed, the core loop advertises no free capacity and
backs off, avoiding duplicate launches during daemon outages.

## Runtime configuration

The runnable app reads the shared core provisioner variables plus these Docker-specific
variables:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SHIPFOX_PROVISIONER_TEMPLATES_FILE` | yes | - | YAML template file describing labels, optional image override, cpu, memory, and max concurrency. |
| `SHIPFOX_PROVISIONER_DOCKER_HOST` | no | local Docker socket | Docker daemon host used by dockerode. |
| `SHIPFOX_PROVISIONER_DOCKER_NETWORK` | no | - | Docker network attached to runner containers, useful for Compose-local API access. |
| `SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS` | no | - | Comma-separated host mappings added to runner containers, such as `host.docker.internal:host-gateway`. |
| `SHIPFOX_PROVISIONER_DOCKER_LOG_DRIVER` | no | Docker daemon default | Logging driver for runner containers. Built-in and installed plugin driver names are accepted. |
| `SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS` | no | - | JSON object of string-valued driver options. Requires `SHIPFOX_PROVISIONER_DOCKER_LOG_DRIVER`; option values are never logged. |
| `SHIPFOX_PROVISIONER_DOCKER_FAILED_CONTAINER_RETENTION_MS` | no | `3600000` | Retention time for failed runner containers, in milliseconds. Set `0` to disable retention. |
| `SHIPFOX_PROVISIONER_DOCKER_MAX_RETAINED_FAILED_CONTAINERS` | no | `20` | Maximum retained failed runner containers. Set `0` to disable retention. |
| `SHIPFOX_PROVISIONER_REGISTRATION_DEADLINE_MS` | no | `120000` | Maximum time a `created` container may linger before being reaped as stale. |

The core `SHIPFOX_RUNNER_API_URL` variable is injected into runner containers as
`SHIPFOX_API_URL` and defaults to `SHIPFOX_API_URL`. Set it when containers reach the
API through a different hostname or network address than the provisioner process uses.

## Operational logging and failed-container forensics

Provisioner-process logs and runner-container output are separate streams. The
provisioner uses the shared structured logger. Set `LOG_LEVEL` to the lowest
level to create, `LOG_PRETTY=true` for human-readable local output,
`LOG_STDOUT=false` to disable stdout, `LOG_STDOUT_LEVEL` to set the stdout
threshold, `LOG_FILE` to write a second destination, and `LOG_FILE_LEVEL` to
set the file threshold. File parent directories are created automatically.
`LOG_FILE` writes a plain file and does not rotate it. Configure an external
rotation policy, such as `logrotate`, and keep the rotated files within the
disk budget for the host. The logger keeps the file open, so use `copytruncate`
in the rotation rule or restart the provisioner after a rename/create rotation;
otherwise it continues writing to the old inode. For production, prefer stdout
and let journald or the container runtime handle rotation.

The provisioner never copies runner stdout or stderr into its own logs. Runner
containers inherit the Docker daemon logging driver unless
`SHIPFOX_PROVISIONER_DOCKER_LOG_DRIVER` is set. A provisioner override is
applied only to containers it creates; existing containers keep their original
Docker logging configuration. Docker validates driver-specific options when a
container is created, and option names are reported without option values.

For a local driver with bounded on-host rotation:

```sh
export SHIPFOX_PROVISIONER_DOCKER_LOG_DRIVER=local
export SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS='{"max-size":"10m","max-file":"5"}'
```

For journald:

```sh
export SHIPFOX_PROVISIONER_DOCKER_LOG_DRIVER=journald
export SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS='{"tag":"shipfox-runner/{{.Name}}"}'
journalctl CONTAINER_NAME=<runner-name> --since today
```

Ensure journald persistence is enabled (`Storage=persistent` in
`/etc/systemd/journald.conf`) and that its rotation and disk limits are
configured before relying on it for incident evidence. Remote drivers should
be configured with their durable backend's retention, access, and rotation
policy. For `local` and `json-file`, `docker logs --timestamps --tail 200
<runner-name>` works only while the container remains; cleanup removes the
container and its writable layer. For `journald` and remote drivers, use the
persistent logging backend after cleanup.

Failed containers are retained only when both retention settings are greater
than zero. The default TTL is one hour and the default bound is 20 containers.
The TTL uses Docker's `FinishedAt` timestamp. If `FinishedAt` is missing, the
first observation of the failure is used instead of creation time, so a
long-running container is not removed immediately. When terminal inspection is
unavailable, TTL cleanup is deferred while the container remains count-bounded.
Unknown failure times are ranked as newly observed for count eviction. Expired
containers and the oldest containers over the count bound are removed on
observation. Successful, dead, stale-created, and backend-terminated containers
keep their immediate cleanup behavior. A retained failed container releases
capacity immediately, and its failure record is emitted once per provisioner
process. Inspect a failure using the command for its logging driver: use
`docker logs --timestamps --tail 200 <runner-name>` for `local` or `json-file`,
`journalctl CONTAINER_NAME=<runner-name>` for `journald`, and the configured
durable backend for remote drivers. The `none` driver has no container output.
When Docker runs on a remote host, target the same daemon before using a Docker
command, for example `DOCKER_HOST="$SHIPFOX_PROVISIONER_DOCKER_HOST" docker
logs ...`; omit `DOCKER_HOST` when the provisioner uses the local default.
Run `journalctl` on the Docker daemon host, not on the operator workstation.

## Development

The package's default test command is unit-only and excludes the Docker-dependent
integration fixture. From the repository root, run
`pnpm --filter @shipfox/provisioner-docker-provider test:integration` explicitly
when a Docker daemon and the `alpine:3.20` image are available.

```sh
turbo check --filter=@shipfox/provisioner-docker-provider
turbo type --filter=@shipfox/provisioner-docker-provider
turbo test --filter=@shipfox/provisioner-docker-provider
```

## Runner image

When a template omits `image`, it defaults to the published
`ghcr.io/shipfoxhq/runner:latest` image. This moving tag is intentional so new
published runner releases become the default without changing the template. Any
explicit image value, including an immutable digest, must run the Shipfox runner
process and honor the injected environment. Omit the key to use the default; a
blank value is invalid. Docker may reuse a locally cached `latest` image, so refresh
the image on the host to pick up a newer release.

- `SHIPFOX_API_URL`
- `SHIPFOX_RUNNER_BOOTSTRAP_TOKEN`
- `SHIPFOX_RUNNER_LABELS`
- `SHIPFOX_POLL_MAX_DURATION_MS`

The image must not bake in a static manual registration token. It exchanges the single-use
bootstrap token (`sf_rbt_...`) minted for its runner instance before waiting for assignment.

## License

MIT
