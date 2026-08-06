# @shipfox/provisioner-ec2-provider

The EC2 provider scaffold for the Shipfox provisioner. It currently loads and validates
EC2 template configuration for the provider-agnostic
[`@shipfox/provisioner-core`](../core) control loop. The EC2 engine, lifecycle, and app
wiring land in later issues.

## Public API

- `loadEc2Templates(filePath)` reads, parses, and validates EC2 template YAML.
- `Ec2TemplateSpec` describes the EC2 launch details for a template.
- `Ec2TemplateConfigError` identifies a missing, malformed, or invalid template file.
- `renderRunnerBootstrapUserData(options)` renders cloud-init for the prebaked managed-runner image.
- `redactRunnerBootstrapUserData(options)` returns launch metadata that is safe to log.

The user-data renderer writes the API URL, one-use bootstrap token, runner-declared labels,
managed-runner protocol metadata, poll deadline, and watchdog lifetime. It never renders a
workspace ID, workspace registration token, or activation token.

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
  iam_instance_profile: shipfox-runner
  associate_public_ip: false
  root_volume_gb: 100
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

`iam_instance_profile` is the IAM instance-profile name, not its ARN. For Spot templates,
`spot_max_price: null` caps the request at the on-demand price and is the recommended
default. Set `cost` to an explicit unitless ranking where lower values win template
selection. Give a Spot template a lower cost than its on-demand equivalent so the planner
prefers Spot before spilling to on-demand capacity.

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
| `SHIPFOX_PROVISIONER_EC2_REGISTRATION_DEADLINE_MS` | no | `300000` | Maximum time a launched instance may wait for runner registration. Also sets the reservation lifetime the provider requests on each demand poll. |
| `SHIPFOX_PROVISIONER_EC2_RECONCILE_INTERVAL_MS` | no | `60000` | Interval for a full backend reconcile using EC2 instance tags. |

The API clamps the requested reservation lifetime to its own `RESERVATION_TTL_MAX_SECONDS`
ceiling and does not report the clamp. Raising the registration deadline past that ceiling
therefore shortens the reservation relative to the deadline: raise both together.

## Behavior notes

The provider deduplicates terminal observations by AWS instance ID while AWS keeps
the instance in the managed listing.
It reports pending, running, stopping, and shutting-down states on each observation.
Stopped instances remain eligible for termination. Shutting-down and terminated
instances do not trigger another AWS termination call.
The in-memory marker resets when the provider restarts.
