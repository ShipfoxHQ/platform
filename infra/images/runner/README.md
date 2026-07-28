# Shipfox runner image

`@shipfox/runner-image` builds the VM image used by ephemeral Shipfox platform runners. It produces an AWS AMI with Packer's `amazon-ebs` builder and a raw QEMU image from the same provisioning definition. It does not replace `apps/runner/Dockerfile`.

## Build

Builds run the production deploy inside the target VM. This is required because the runner contains architecture-specific native payloads. The wrapper obtains the Node version from `mise`, prunes `@shipfox/runner`, and then invokes Packer.

```sh
BUILD_ARCH=amd64 BUILD_ATTEMPT=1 BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS=123456789012,210987654321 BUILD_CANDIDATE_KMS_KEY_ID=alias/shipfox-runner-image-candidate BUILD_NUMBER=42 BUILD_REVISION=0123456789abcdef0123456789abcdef01234567 pnpm --filter=@shipfox/runner-image exec node ./bin/build-runner-image-candidate.js --output /tmp/runner-image-candidate.json
BUILD_ARCH=amd64 BUILD_ATTEMPT=1 BUILD_NUMBER=42 BUILD_RUNNER_VERSION=0.1.0 pnpm --filter=@shipfox/runner-image exec node ./bin/build-runner-image.js ubuntu24 qemu
```

The AMI source uses Canonical Ubuntu 24.04 and requires AWS credentials in `eu-central-1`. The QEMU build defaults to a pinned Canonical Ubuntu 24.04 release image and configures its temporary Packer SSH access through a NoCloud seed; the final image locks that bootstrap account. To use a different QEMU source, set both `SHIPFOX_QEMU_SOURCE_IMAGE` and `SHIPFOX_QEMU_SOURCE_CHECKSUM` (for example, `sha256:<digest>`). Relative source paths resolve from the repository root.

Packer is pinned in `mise.toml`. Install QEMU and `xorriso` through the host operating system before running a QEMU build.

## Environment contract

Cloud-init writes `/etc/shipfox/runner.env`. The provider owns the values and must never bake them into the image:

- `SHIPFOX_API_URL`: API base URL.
- `SHIPFOX_RUNNER_BOOTSTRAP_TOKEN`: one-use managed-runner bootstrap token.
- `SHIPFOX_RUNNER_PROVIDER_KIND`: provider identifier declared during enrollment, such as `ec2`.
- `SHIPFOX_RUNNER_PROTOCOL_VERSION`: managed-runner protocol version. The current image supports `1`.
- `SHIPFOX_RUNNER_LABELS`: comma-separated runner labels.
- `SHIPFOX_POLL_MAX_DURATION_MS`: runner polling deadline. `0` means forever.
- `SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS`: hard instance lifetime. Use a value comfortably above one job's maximum duration.
- `AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS=false`: required for cloud runners.

The image derives its tool capabilities from its baked runner runtime and sends them during
enrollment. Providers do not inject capabilities, workspace IDs, workspace registration tokens,
or activation tokens into user data.

`shipfox-runner.service` powers off immediately when the runner exits. Its SIGTERM drain budget is 90 seconds, after which systemd can force-kill the process and the backend re-reserves the job. `shipfox-max-lifetime.service` schedules a forced poweroff and falls back to a baked 3600-second limit when the configured value is missing or malformed. AWS builds also enable a Spot IMDSv2 watcher that stops the runner, allows it to drain briefly, then powers off.

With `InstanceInitiatedShutdownBehavior=terminate` and Spot `InstanceInterruptionBehavior=terminate`, provider-side settings convert these poweroffs into EC2 termination. The in-guest watchdog is the fast path. The durable backstop remains tagged-instance reconciliation, the backend staleness reaper, and terminate-on-shutdown because privileged job steps or a wedged kernel can defeat an in-guest timer.

## Recovery drill

On EC2, launch a runner with a short max lifetime, stop the provisioner, and verify the instance terminates before that bound. For Spot, request an interruption notice in a test environment and verify the runner stops claiming work, drains, and powers off before reclaim. These drills feed the EC2 provisioner deployment runbook.

## Candidate builds

After every successful merge to `main`, CI builds one candidate AMI per architecture in the candidate AWS account. Candidates are not releases: CI shares them only with the configured worker-plane accounts and publishes one immutable OCI manifest at the full source revision. There is no moving `latest` or `main` pointer.

The candidate command writes its AMI ID, architecture, region, owner, creation time, expiration time, source SHA, and whether it built or reused the image to its required `--output` JSON file. The AMI tags are the discovery contract. Internal users resolve an available image by its exact source SHA and architecture with `shipfox.managed=true`, `shipfox.lifecycle=candidate`, `shipfox.candidate_id`, `shipfox.revision`, and `shipfox.architecture`. Candidates are encrypted with `BUILD_CANDIDATE_KMS_KEY_ID`, shared with the comma-separated or JSON-array account IDs in `BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS`, and retain the 14-day expiry.

CI assumes `AWS_RUNNER_IMAGE_ROLE_ARN` through GitHub OIDC. Repository variables `AWS_RUNNER_IMAGE_CANDIDATE_KMS_KEY_ID` and `AWS_RUNNER_IMAGE_CANDIDATE_CONSUMER_ACCOUNT_IDS` supply the candidate distribution inputs; account IDs are intentionally not Packer source defaults. The role must belong to the candidate account and trust only `ShipfoxHQ/shipfox` builds from `main`. Candidate AMIs must not be used by production provisioning.

QEMU output is test-only and is not published as a distributed artifact. The supported consumer path is a local or CI build followed by a boot test:

```sh
BUILD_ARCH=amd64 BUILD_ATTEMPT=1 BUILD_NUMBER=42 BUILD_RUNNER_VERSION=0.1.0 pnpm --filter=@shipfox/runner-image exec node ./bin/build-runner-image.js ubuntu24 qemu
```

The automated QEMU boot and watchdog suite is tracked in ENG-1022.
