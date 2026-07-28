# @shipfox/provisioner-docker

Runs the Docker provisioner: it watches aggregate runner demand on the Shipfox API
and starts one-job ephemeral runner containers to meet it.

This app is a thin entry point. The control loop lives in
[`@shipfox/provisioner-core`](../../libs/provisioner/core) and the Docker-specific
configuration and launcher live in
[`@shipfox/provisioner-docker-provider`](../../libs/provisioner/docker).

## What it does

The provisioner runs two independent loops:

- The convergence loop observes local Docker containers and reports lifecycle.
- The demand loop:

  1. Builds current per-template capacity advertisements, long-polls the API for
     demand, and receives count-based reservations.
  2. Chooses a local template for each reservation's label set, deterministically,
     filling the cheapest matching template first.
  3. Batch-mints one single-use registration token per planned runner.
  4. Creates and starts one Docker container per runner.

It respects each template's `max_concurrency` before requesting reservations, so it
never reserves more than it can start.

Containers are named by `provisioned_runner_id` and labeled with `shipfox.*` metadata
so a restarted provisioner can rebuild local capacity from Docker state. Running
containers are re-reported every convergence cycle to keep the backend active-runner view fresh.
Exited containers are reported as `stopped` or `failed`. Successful exits are removed
immediately; failed exits are retained for the configured forensic TTL/count bound and
then cleaned up. Containers stuck in Docker's `created` state past the registration
deadline are reaped as stale pre-run resources; running containers are never locally killed.

If Docker cannot be observed, the provisioner advertises no free capacity and backs off
until observation succeeds.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SHIPFOX_API_URL` | no | `https://api.shipfox.io` | Base URL of the Shipfox API. Set it for a self-hosted API. |
| `SHIPFOX_RUNNER_API_URL` | no | `SHIPFOX_API_URL` | API URL injected into runner containers as `SHIPFOX_API_URL`; set it when containers reach the API through a different address. |
| `SHIPFOX_PROVISIONER_TOKEN` | yes | — | Long-lived provisioner token (keep it in `.env.local`, never commit it). |
| `SHIPFOX_PROVISIONER_TEMPLATES_FILE` | yes | — | Path to the YAML template file (see `templates.example.yaml`). |
| `SHIPFOX_PROVISIONER_DOCKER_HOST` | no | local Docker socket | Docker daemon host used by dockerode. |
| `SHIPFOX_PROVISIONER_DOCKER_NETWORK` | no | — | Docker network attached to runner containers, for example a Compose network that can reach the API. |
| `SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS` | no | — | Comma-separated host mappings added to runner containers, such as `host.docker.internal:host-gateway`. |
| `SHIPFOX_PROVISIONER_DOCKER_LOG_DRIVER` | no | Docker daemon default | Logging driver for runner containers. |
| `SHIPFOX_PROVISIONER_DOCKER_LOG_OPTIONS` | no | — | JSON object of string-valued driver options; requires the driver setting. |
| `SHIPFOX_PROVISIONER_DOCKER_FAILED_CONTAINER_RETENTION_MS` | no | `3600000` | Failed-container retention TTL in milliseconds; `0` disables retention. |
| `SHIPFOX_PROVISIONER_DOCKER_MAX_RETAINED_FAILED_CONTAINERS` | no | `20` | Maximum retained failed containers; `0` disables retention. |
| `SHIPFOX_PROVISIONER_REGISTRATION_DEADLINE_MS` | no | `120000` | How long a `created` runner container may linger before being reaped as stale. |
| `SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS` | no | `30` | Long-poll wait per demand request. |
| `SHIPFOX_PROVISIONER_POLL_INTERVAL_MS` | no | `1000` | Base delay between polls; backs off on error. |
| `SHIPFOX_PROVISIONER_POLL_MAX_INTERVAL_MS` | no | `5000` | Backoff ceiling. |
| `SHIPFOX_PROVISIONER_CONVERGE_INTERVAL_MS` | no | `1000` | Provider observation and reconciliation cadence; backs off on errors up to the larger of 5000ms and this cadence. |
| `SHIPFOX_PROVISIONER_MAX_RESERVATIONS` | no | `250` | Most reservations requested per poll (also capped by free capacity and the API's limit of 1000). |
| `SHIPFOX_PROVISIONER_RUNNER_INSTANCE_BATCH_SIZE` | no | `250` | Runner instances created per request (1–1000). |
| `SHIPFOX_RUNNER_POLL_MAX_DURATION_MS` | no | `300000` | Injected into each runner as `SHIPFOX_POLL_MAX_DURATION_MS`. |

## Runner image

When a template omits `image`, the provisioner uses the published
`ghcr.io/shipfoxhq/runner:latest` image. This moving tag is intentional so new
published runner releases become the default without changing the template. A
template may override it with a custom image, including an immutable digest, which
must run the Shipfox runner process and consume the injected environment. Omit the
key to use the default; a blank value is invalid. Docker may reuse a locally cached
`latest` image, so refresh the image on the host to pick up a newer release.

- `SHIPFOX_API_URL`
- `SHIPFOX_RUNNER_BOOTSTRAP_TOKEN`
- `SHIPFOX_RUNNER_LABELS`
- `SHIPFOX_POLL_MAX_DURATION_MS`

Do not bake a static manual registration token into the image or container environment. The
provisioner injects one single-use bootstrap token (`sf_rbt_...`) per runner instance.

## Run locally

```sh
# Set SHIPFOX_PROVISIONER_TOKEN in apps/provisioner-docker/.env.local first.
pnpm --filter=@shipfox/provisioner-docker dev
```
