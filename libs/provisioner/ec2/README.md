# @shipfox/provisioner-ec2-provider

The EC2 provider loads and validates template configuration, runs the EC2 lifecycle, and
reports capacity through the provider-agnostic [`@shipfox/provisioner-core`](../core)
control loop.

## Public API

- `loadEc2Templates(filePath)` reads, parses, and validates EC2 template YAML.
- `Ec2TemplateSpec` describes the EC2 launch details for a template.
- `Ec2TemplateConfigError` identifies a missing, malformed, or invalid template file.
- `renderRunnerBootstrapUserData(options)` renders the raw IMDS user-data environment for the prebaked managed-runner image.
- `redactRunnerBootstrapUserData(options)` returns launch metadata that is safe to log.

The user-data renderer writes the API URL, one-use bootstrap token, runner-declared labels,
managed-runner protocol metadata, the managed workspace root, poll deadline, and watchdog
lifetime. The image's EC2 bootstrap service formats and mounts the non-root EBS volume before
the runner starts. It never renders a workspace ID, workspace registration token, or
activation token.

## Health checks

Backend reconciliation reads EC2 system, instance, and attached-EBS status checks and scheduled
events with `ec2:DescribeInstanceStatus`. The provisioner role must grant that action in the
runner region. An authorization or other permanent status-read failure fails the reconciliation
closed; a transient or stale-instance status-read failure keeps the ordinary `DescribeInstances`
snapshot and submits no health candidate.
Candidates require an impairment that is at least one reconciliation interval old or two
consecutive close observations. Candidates are requests to the existing backend authorization
gate, not direct termination calls. Regular observation, termination lookup, and service metrics
omit status checks so they do not poll the status API unnecessarily.

## Template config

The template file can contain shared `vars`, a `defaults` fragment, hand-written
`templates`, and independent `matrix` families. Operators own the lookup maps under
`vars`; the provider does not ship AWS instance-family or ratio tables.

```yaml
vars:
  ami_by_arch_os:
    x64:
      ubuntu2404: ami-0123456789abcdef0
  instance_family_by_arch_cpu:
    x64:
      4: m7i
  size_by_cpu:
    4: xlarge
  gpu_ami_by_model_driver:
    a10:
      cuda12: ami-0123456789abcde10
  gpu_instance_type_by_model:
    a10: g5.2xlarge

defaults:
  labels: [ec2]
  subnets: [subnet-general-a, subnet-general-b]
  security_groups: [sg-runner]
  associate_public_ip: false
  root_volume_gb: 30
  root_device_name: /dev/sda1
  workspace_volume_gb: 100
  workspace_device_name: /dev/sdf
  max_concurrency: 50
  target_concurrency: 0

templates:
  ec2-one-off-debug:
    labels: [ec2, debug]
    ami: ami-0123456789abcdef9
    instance_type: t3.small
    market: on-demand
    subnets: [subnet-general-a]
    max_concurrency: 2
    cost: 1

matrix:
  general:
    axes:
      arch: [x64]
      cpu: [4]
      os: [ubuntu2404]
    template:
      labels: [ec2, "${{ arch }}", "${{ os }}", "${{ cpu }}vcpu"]
      ami: "${{ vars.ami_by_arch_os[arch][os] }}"
      instance_type: "${{ vars.instance_family_by_arch_cpu[arch][cpu] }}.${{ vars.size_by_cpu[cpu] }}"
      market: on-demand
      cost: "${{ cpu }}"

  gpu:
    axes:
      model: [a10]
      driver: [cuda12]
    template:
      labels: [ec2, gpu, "${{ model }}", "${{ driver }}"]
      ami: "${{ vars.gpu_ami_by_model_driver[model][driver] }}"
      instance_type: "${{ vars.gpu_instance_type_by_model[model] }}"
      market: spot
      spot_max_price: 1.25
      subnets: [subnet-gpu]
      cost: 25
```

Loading fails fast with a clear, file-scoped error on a missing file, malformed YAML, an
invalid or unknown field, an unusable label, or an empty template set. Labels are
canonicalized with the shared runner-label rules.

Runner instances deliberately do not accept an IAM instance profile: job code has passwordless
root and unrestricted access to IMDS, so an instance profile would expose its credentials to the
job. This change intentionally leaves no host-shell access until ENG-1541 provisions the EC2
Instance Connect Endpoint; the base image's deb-backed EC2 Instance Connect and SSH socket are
kept for that follow-up. For Spot templates, `spot_max_price: null` caps the request at the
on-demand price and is the recommended default. Set `cost` to an explicit unitless ranking where
lower values win template selection. Give a Spot template a lower cost than its on-demand
equivalent so the planner prefers Spot before spilling to on-demand capacity.

`root_volume_gb` is the boot volume size. `workspace_volume_gb` is a separate, encrypted gp3
volume created for per-job checkouts, logs, and credentials. The provider deletes both
volumes with the instance. `workspace_device_name` is the EC2 block-device mapping name;
the EC2 bootstrap service resolves the attached EBS disk to its runtime device before
formatting and mounting it at `/var/lib/shipfox/workspaces`. It fails closed when the
non-root EBS disk is absent or not unique.

The example defaults change general runner capacity from one 100 GB EBS volume to a 30 GB
boot volume plus a 100 GB workspace volume (130 GB total). The GPU example uses 30 GB plus
200 GB (230 GB total). EBS storage cost therefore increases with the extra 30 GB, while the
exact amount depends on region, runner uptime, gp3 IOPS and throughput, and KMS settings.
The split keeps job data out of the boot image and its snapshots.

Families are independent. The general and GPU families above use different axes and
markets; the GPU block's `subnets` replaces the general default list rather than
appending to it. Labels may overlap across families because matching is subset-based;
the lowest `cost` wins before specificity does. A hand-written entry under `templates:`
shadows a generated key and is the per-variant override idiom.

The runnable two-family example, including the complete AMI lookup maps, lives at
[`apps/provisioner-ec2/templates.example.yaml`](../../../apps/provisioner-ec2/templates.example.yaml).

## Runtime configuration

The provider reads the shared provisioner variables plus these EC2-specific variables:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SHIPFOX_PROVISIONER_TEMPLATES_FILE` | yes | - | YAML template file with EC2 launch and capacity configuration. |
| `AWS_REGION` | yes | - | AWS region where runner instances launch. |
| `SHIPFOX_PROVISIONER_EC2_REGISTRATION_DEADLINE_MS` | no | `300000` | Maximum time a launched instance may wait for runner registration. The provider adds the launch headroom and uses the sum to derive the reservation lifetime it requests on each demand poll. |
| `SHIPFOX_PROVISIONER_EC2_LAUNCH_HEADROOM_MS` | no | `30000` | Extra time for the API response and EC2 launch call before EC2 records the instance launch time. The provider adds this to the registration deadline before deriving the reservation lifetime. |
| `SHIPFOX_PROVISIONER_EC2_RECONCILE_INTERVAL_MS` | no | `60000` | Interval for a full backend reconcile using EC2 instance tags. |
| `SHIPFOX_PROVISIONER_EC2_STOPPING_TIMEOUT_MS` | no | `300000` | Time an authorized instance may remain in `stopping` before one forced termination retry. |

The reservation clock starts when the API grants demand. The EC2 registration clock starts
when EC2 records the instance launch time. The provider requests
`ceil((registration deadline + launch headroom) / 1000)` seconds, so the reservation covers
the launch gap as well as boot and enrollment.

The API clamps the requested reservation lifetime to its own `RESERVATION_TTL_MAX_SECONDS`
ceiling and does not report the clamp. Keep that ceiling at least as high as the derived
value when changing either EC2 setting.

## Service metrics

The provider exposes per-template saturation gauges on the service metrics endpoint.
The `template_key` label is the rendered template key, not a raw demand label set.

| Metric | Value |
| --- | --- |
| `ec2_provisioner_template_runners{state}` | EC2 instances charged against the template cap. `pending` instances report as `starting`; unknown states report as `running`. |
| `ec2_provisioner_template_max_concurrency` | Configured ceiling for the template. |
| `ec2_provisioner_template_target_concurrency` | Configured warm-pool floor for the template. |
| `ec2_provisioner_template_queued_demand` | Queued jobs whose labels match the template. |
| `ec2_provisioner_template_oldest_queued_age` | Age of the oldest matching queued job in milliseconds. |

The runner count reads `shipfox.template_key` from AWS `DescribeInstances` results.
The production ECS module keeps one provisioner task, so this fleet count matches the
per-process `max_concurrency` cap. AWS listings are eventually consistent and can briefly
undercount a new launch. Queue gauges use the latest demand poll and map each label set to
every ranked matching template.
If a demand poll fails, the core adapter clears the cached snapshot so queue gauges do not
retain stale saturation values.

Each rendered template creates six time series: two runner states and four single-series
gauges. Matrix families multiply their axis sizes, so keep the rendered template count
bounded when adding an axis.

## Behavior notes

Search for `Observed EC2 runner instance termination` to find one terminal log per AWS
instance ID. The provider keeps the marker while AWS lists the instance, and for one
hour after a listing gap.
The provider reports non-terminal states on every observation.
When the provider terminates an instance, it reports `terminated` with either
`backend-terminate` or `registration-deadline`.
An authorized instance that remains in `stopping` past its configured timeout receives one forced termination retry.
The retry reuses the API's first-observed `stopping_at` timestamp and does not create authorization.
A live bound job fences the retry; a bound job with cancellation requested does not, because the API has already authorized cleanup.
If `stopping_at` is absent, the provider logs the compatibility degradation and uses one graceful termination instead of a timeout retry.
Stopped instances remain eligible for termination. Shutting-down and terminated
instances do not trigger another AWS termination call.
The in-memory marker resets when the provider restarts.
