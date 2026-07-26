# @shipfox/provisioner-docker-provider

The Docker provider for the Shipfox provisioner. It supplies the Docker-specific
configuration and launcher that [`@shipfox/provisioner-core`](../core) drives, and is
wired into the runnable [`@shipfox/provisioner-docker`](../../../apps/provisioner-docker)
app.

## Public API

- `startDockerProvisioner()` — load the local Docker templates and run the control
  loop against them.
- `loadDockerTemplates(filePath)` — read, parse, and validate the template YAML,
  returning provider-agnostic `ProvisionerTemplate`s with a `DockerTemplateSpec`.
- `DockerTemplateSpec` — the Docker launch details (`image`, `cpu`, `memory`).
- `DockerTemplateConfigError` — thrown on any config problem.

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
an invalid field, an unusable label, or an empty template set. Labels are canonicalized
(trim, lowercase, dedupe, sort) with the shared runner-label rules. The vCPU count
becomes the template's selection cost, so generic demand lands on the cheapest box.

## Current behavior

This package loads and validates Docker template configuration, joins the shared
provisioner control loop, and starts one Docker container per reserved runner. Each
container is named by its `provider_runner_id` and carries `shipfox.*` labels so a
restarted provisioner can rebuild local capacity from Docker state.

The provider reports lifecycle through the API:

- `starting` before container creation.
- `running` on every observe tick for running containers.
- `stopped` or `failed` after exited containers, then removes them.
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
| `SHIPFOX_PROVISIONER_REGISTRATION_DEADLINE_MS` | no | `120000` | Maximum time a `created` container may linger before being reaped as stale. |

The core `SHIPFOX_RUNNER_API_URL` variable is injected into runner containers as
`SHIPFOX_API_URL` and defaults to `SHIPFOX_API_URL`. Set it when containers reach the
API through a different hostname or network address than the provisioner process uses.

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
