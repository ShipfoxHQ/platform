# @shipfox/provisioner-docker

Runs the Docker provisioner: it watches aggregate runner demand on the Shipfox API
and starts one-job ephemeral runner containers to meet it.

This app is a thin entry point. The control loop lives in
[`@shipfox/provisioner-core`](../../libs/provisioner/core) and the Docker-specific
configuration and launcher live in
[`@shipfox/provisioner-docker-provider`](../../libs/provisioner/docker).

## What it does

On each cycle the provisioner:

1. Observes local Docker containers owned by this provisioner and reports lifecycle.
2. Advertises its current per-template capacity (free slots, starting, running).
3. Long-polls the API for demand and receives count-based reservations.
4. Chooses a local template for each reservation's label set, deterministically,
   filling the cheapest matching template first.
5. Batch-mints one single-use registration token per planned runner.
6. Creates and starts one Docker container per runner.

It respects each template's `max_concurrency` before requesting reservations, so it
never reserves more than it can start.

Containers are named by `provisioned_runner_id` and labeled with `shipfox.*` metadata
so a restarted provisioner can rebuild local capacity from Docker state. Running
containers are re-reported every tick to keep the backend active-runner view fresh.
Exited containers are reported as `stopped` or `failed`, then removed after the report
is accepted. Containers stuck in Docker's `created` state past the registration deadline
are reaped as stale pre-run resources; running containers are never locally killed.

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
| `SHIPFOX_PROVISIONER_REGISTRATION_DEADLINE_MS` | no | `120000` | How long a `created` runner container may linger before being reaped as stale. |
| `SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS` | no | `30` | Long-poll wait per demand request. |
| `SHIPFOX_PROVISIONER_POLL_INTERVAL_MS` | no | `1000` | Base delay between polls; backs off on error. |
| `SHIPFOX_PROVISIONER_POLL_MAX_INTERVAL_MS` | no | `5000` | Backoff ceiling. |
| `SHIPFOX_PROVISIONER_MAX_RESERVATIONS` | no | `250` | Most reservations requested per poll (also capped by free capacity and the API's limit of 1000). |
| `SHIPFOX_PROVISIONER_RUNNER_INSTANCE_BATCH_SIZE` | no | `250` | Runner instances created per request (1–1000). |
| `SHIPFOX_RUNNER_POLL_MAX_DURATION_MS` | no | `300000` | Injected into each runner as `SHIPFOX_POLL_MAX_DURATION_MS`. |

## Runner image

When a template omits `image`, the provisioner uses the published
`ghcr.io/shipfoxhq/runner:latest` image. This moving tag is intended for local
development. The deployment bundle pins an immutable runner tag that matches
the provisioner image. A template may override the default with a custom image
or immutable digest. The image must run the Shipfox runner process and consume
the injected environment. A blank value is invalid.

The production-shaped Compose bundle is
[`compose.yaml`](compose.yaml), [`.env.example`](.env.example), and
[`templates.yaml`](templates.yaml). The public
[Docker provisioner guide](../docs/content/docs/installation/runner-provisioner.mdx)
owns the operator workflow.

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
