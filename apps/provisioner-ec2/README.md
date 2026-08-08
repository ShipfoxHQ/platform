# @shipfox/provisioner-ec2

Runs one-job Shipfox runners on Amazon EC2 from a prebaked AMI.

## What it does

- **Starts runners**: Creates a runner instance and one-use bootstrap token before launch.
- **Uses EC2 tags**: Finds and adopts its instances after a restart.
- **Keeps state in sync**: Reports state, reaps missed enrollment, and applies terminate requests.
- **Protects credentials**: Sends bootstrap data to the AMI. It never sends workspace registration credentials.

## Setup

Copy [`templates.example.yaml`](templates.example.yaml). Set
`SHIPFOX_PROVISIONER_TEMPLATES_FILE` to that copy. Set `target_concurrency` above
zero to keep ready runners without demand.

The AMI must include the Shipfox runner and its shutdown watchdog. Cloud-init writes
`/etc/shipfox/runner.env` with the API URL, one-use token, labels, workspace root, poll time,
and maximum lifetime. It formats and mounts the separate workspace volume at
`/var/lib/shipfox/workspaces` before the runner starts. The AMI reads that file and shuts
down when its watchdog exits.

## Template families

The checked-in [`templates.example.yaml`](templates.example.yaml) contains a general
on-demand fleet and an independent GPU Spot pool. They use different axes, markets,
and subnet lists, so adding GPU capacity does not widen the general fleet's
cross-product. The file also keeps one genuine one-off under `templates:`.

EC2 operators provide their own AMI and instance-type lookup maps under `vars`.
`defaults` applies common launch settings to every family, but a list override such
as the GPU `subnets` replaces the default list rather than appending to it. Labels may
overlap across families; lower `cost` wins when more than one template matches.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SHIPFOX_API_URL` | no | `https://api.shipfox.io` | Base URL of the Shipfox API. Set it for a self-hosted API. |
| `SHIPFOX_RUNNER_API_URL` | no | `SHIPFOX_API_URL` | API URL injected into runner instances when they reach the API through a different address. |
| `SHIPFOX_PROVISIONER_TOKEN` | yes | N/A | Long-lived provisioner token. |
| `SHIPFOX_PROVISIONER_TEMPLATES_FILE` | yes | N/A | Path to the EC2 template YAML file. |
| `AWS_REGION` | yes | N/A | AWS region where the provider launches instances. |
| `SHIPFOX_PROVISIONER_EC2_REGISTRATION_DEADLINE_MS` | no | `300000` | Maximum time an EC2 instance may remain pending without runner enrollment. |
| `SHIPFOX_PROVISIONER_EC2_LAUNCH_HEADROOM_MS` | no | `30000` | Extra time for the API response and EC2 launch call before EC2 records the instance launch time. Added to the registration deadline to derive the requested reservation lifetime. |
| `SHIPFOX_PROVISIONER_EC2_RECONCILE_INTERVAL_MS` | no | `60000` | Interval between full EC2/backend reconciliation passes. |
| `SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS` | no | `30` | Demand long-poll duration. |
| `SHIPFOX_PROVISIONER_POLL_INTERVAL_MS` | no | `1000` | Delay between healthy demand polls. |
| `SHIPFOX_PROVISIONER_POLL_MAX_INTERVAL_MS` | no | `5000` | Maximum error-backoff interval. |
| `SHIPFOX_PROVISIONER_CONVERGE_INTERVAL_MS` | no | `1000` | Shared provider observation cadence. EC2 keeps full backend reconciliation on its separate EC2 interval. |
| `SHIPFOX_PROVISIONER_MAX_RESERVATIONS` | no | `250` | Largest demand reservation request. |
| `SHIPFOX_PROVISIONER_RUNNER_INSTANCE_BATCH_SIZE` | no | `250` | Runner instances created per control-plane request. |
| `SHIPFOX_RUNNER_POLL_MAX_DURATION_MS` | no | `300000` | Idle polling lifetime injected into each runner. |
| `SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS` | no | `3600` | Hard lifetime injected into each runner watchdog. |

## Development

```sh
# Create apps/provisioner-ec2/.env.local with the required values.
pnpm --filter=@shipfox/provisioner-ec2 dev

turbo check --filter=@shipfox/provisioner-ec2
turbo type --filter=@shipfox/provisioner-ec2
turbo test --filter=@shipfox/provisioner-ec2-provider
```

Build the image with:

```sh
pnpm --filter=@shipfox/provisioner-ec2 image
```

## License

MIT
