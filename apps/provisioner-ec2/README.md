# @shipfox/provisioner-ec2

Runs one-job Shipfox runners on Amazon EC2 from a prebaked AMI.

## What it does

- **Starts runners**: Creates a runner instance and one-use bootstrap token before launch.
- **Uses EC2 tags**: Finds and adopts its instances after a restart.
- **Keeps state in sync**: Reports state, requests backend authorization for missed enrollment,
  and applies authorized termination requests.
- **Protects credentials**: Sends bootstrap data to the AMI. It never sends workspace registration credentials.

## Setup

Copy [`templates.example.yaml`](templates.example.yaml). Set
`SHIPFOX_PROVISIONER_TEMPLATES_FILE` to that copy. Set `target_concurrency` above
zero to keep ready runners without demand.

The AMI must include the Shipfox runner and its shutdown watchdog. `shipfox-bootstrap.service`
reads IMDSv2 user data and writes `/etc/shipfox/runner.env`. It formats and mounts the separate
workspace volume at `/var/lib/shipfox/workspaces` before the runner starts. The AMI reads that
file and shuts down when its watchdog exits.

### AMI migration

The split-volume launch contract requires AMIs to be rebuilt before using the 30 GB boot
volume in the example defaults. An older AMI can contain more root data than the smaller
volume accepts, which makes the launch fail. Publish and repoint the replacement AMI before
deploying the provider change. The old AMI expects cloud-init YAML; the new image expects a
raw environment file. A rollback requires a provider and AMI from the same contract. During
the transition, keep `root_volume_gb` at or above the old AMI's root snapshot size until every
template uses a rebuilt AMI.

## Template families

The checked-in [`templates.example.yaml`](templates.example.yaml) contains a general
on-demand fleet and an independent GPU Spot pool. They use different axes, markets,
and subnet lists, so adding GPU capacity does not widen the general fleet's
cross-product. The file also keeps one genuine one-off under `templates:`.

EC2 operators provide their own AMI and instance-type lookup maps under `vars`.
`defaults` applies common launch settings to every family, but a list override such
as the GPU `subnets` replaces the default list rather than appending to it. Labels may
overlap across families; lower `cost` wins when more than one template matches.

The EC2 launch and termination counters use the expanded template key as a label.
Keys are trimmed and must start with a letter or number, contain only letters, numbers,
dots, underscores, or hyphens, and be at most 128 characters. The provider accepts at
most 256 expanded templates; the checked-in example expands to 11 keys: one hand-written
template, eight general variants (`2 × 2 × 2`), and two GPU variants (`2 × 1`). Keep
production matrix axes bounded because each additional template adds another series to
these counters.

Instances with a missing, malformed, or no-longer-configured `shipfox.template_key` use
the reserved `__unattributed__` series for termination metrics and logs. Do not use that
key in configuration. Renaming a template intentionally separates its existing launch
series from later termination series, so preserve keys when historical attribution must
remain continuous.

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

Before deploying registration-deadline cleanup, enable
`RUNNER_TERMINATION_REASON_REGISTRATION_DEADLINE_ENABLED=true` in the runners API. The flag
defaults to false; an EC2 provider safely keeps overdue instances out of capacity and retries
backend authorization while it remains disabled.

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
