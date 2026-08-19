# Shipfox runner image

`@shipfox/runner-image` builds the VM image used by ephemeral Shipfox platform runners. It produces an AWS AMI with Packer's `amazon-ebs` builder and a raw QEMU image from the same provisioning definition. It does not replace `apps/runner/Dockerfile`.

## Build

Builds run the production deploy inside the target VM. This is required because the runner contains architecture-specific native payloads. The wrapper obtains the Node version from `mise`, prunes `@shipfox/runner`, and then invokes Packer.

```sh
BUILD_ARCH=amd64 BUILD_ATTEMPT=1 BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS=123456789012,210987654321 BUILD_CANDIDATE_KMS_KEY_ID=alias/shipfox-runner-image-candidate BUILD_NUMBER=42 BUILD_REVISION=0123456789abcdef0123456789abcdef01234567 pnpm --filter=@shipfox/runner-image exec node ./bin/build-runner-image-candidate.js --output /tmp/runner-image-candidate.json
BUILD_ARCH=amd64 BUILD_ATTEMPT=1 BUILD_NUMBER=42 BUILD_RUNNER_VERSION=0.1.0 pnpm --filter=@shipfox/runner-image exec node ./bin/build-runner-image.js ubuntu24 qemu
```

The AMI source uses Canonical Ubuntu 24.04 and requires AWS credentials in `eu-central-1`. The QEMU build uses a pinned Canonical Ubuntu 24.04 release image. Packer accesses QEMU through a temporary NoCloud seed. The seed is consumed during the build and is not part of the runtime contract. To use a different QEMU source, set `SHIPFOX_QEMU_SOURCE_IMAGE` and `SHIPFOX_QEMU_SOURCE_CHECKSUM` (for example, `sha256:<digest>`). Relative source paths resolve from the repository root.

Packer is pinned in `mise.toml`. Install QEMU and `xorriso` through the host operating system before running a QEMU build.

## Boot behavior

The image is checked during the bake and starts with `multi-user.target` as the systemd default. It skips boot-time filesystem checks and applies `noatime` to `/` and `/boot`.

The image includes a 4 GiB `/swapfile`; the bake initializes it and persists it in `/etc/fstab` for runner startup.

The fstab entries for `/boot` and `/boot/efi` use `noauto` and pass 0. The partitions remain in the image for the bootloader, but systemd does not mount them during runner startup. `configure-ephemeral-boot.sh` masks the image's package, bootloader, and firmware update units so they cannot write to the detached mount-point directories.

`fsck.mode=skip` also suppresses checks for other filesystems with a non-zero pass number. Do not add a durable filesystem with a non-zero pass number without revisiting this image contract.

The image ships `/etc/systemd/network/10-shipfox-primary.network` and carries no netplan configuration. It matches the `en*` and `eth*` interface families, so one file covers ENA on EC2, virtio and gVNIC on GCP, and virtio on the QEMU build without a per-provider variant. Container and overlay links fall outside both families and stay unmanaged. The file takes DHCPv4, the link MTU from the lease, and disables IPv6 duplicate-address detection.

netplan is not the network configuration owner. A netplan definition is addressed by its identifier, and that identifier reaches both the generated unit file name and the `systemd-networkd-wait-online` interface list, so a definition that matches by glob names an interface that never exists. `.network` files have no identifier and the match is the only interface selector.

The match selects an interface family, so a machine with more than one Ethernet link configures all of them. Each takes its own lease at the same route metric, which leaves the default route between them undefined. The EC2 provisioner attaches exactly one interface at device index 0, so that case does not arise today; a provider that needs several interfaces needs per-interface policy routing rather than a narrower match. `10-shipfox.conf` makes `systemd-networkd-wait-online` succeed on the first routable link and bounds it at 30 seconds, so a second link that never configures cannot hold the boot open or wedge the shutdown.

The image is built for one job and one instance lifetime. The bake applies
filesystem and network boot policy in `configure-boot.sh`, and disposable
service and journal policy in
[`configure-ephemeral-boot.sh`](scripts/build/configure-ephemeral-boot.sh).

### Boot composition gate

The bake checks the default systemd target and re-reads the installed fstab to
confirm that both boot entries use `noauto` and pass 0. It checks that every unit
in the mask inventory exists before it masks the unit. It checks the effective
`systemd` state after masking. It also checks the effective journald configuration
after writing the drop-in. A base-image change that removes a unit, changes a
boot entry, or overrides the drop-in fails the image build.

`verify-network.sh` removes the base image's generated network configuration,
reconfigures the live link from the shipped `.network` file, and waits for it to
become routable. AWS builds then reach IMDSv2 over that link. A build instance
otherwise keeps running on the base image's own configuration for the whole
bake, so an image-provided file that matches no interface passes every text
assertion and strands each launched instance without an address. The check reads
the applied network file back from `networkctl` rather than settling for a
routable link, because a leftover configuration would also report routable.

Both checks run against the link Packer is connected through. The build instance
is a `t3.large` and a launched runner is whatever its template asks for, so this
proves the shipped file selects a real interface and takes a lease, not that it
selects an interface on every instance type. Predictable naming gives every
Ethernet device an `en*` name, which is what makes that gap small rather than
absent. Closing it needs a boot test of the built image on the target instance
types, tracked in ENG-1525.

### AppArmor decision

The runner keeps `apparmor.service` enabled. It also keeps
the base image's AppArmor profiles without changing the security posture. The image
purges `snapd` and removes `/var/lib/snapd` and `/snap` during setup, so the seeded
`amazon-ssm-agent` snap and `snapd.apparmor.service` are absent. This change does not
mask or socket-activate `apparmor.service`.

### Journal retention

The host journal uses volatile storage with a `64M` runtime limit. Journald
allows `1000` messages per service in a `30s` interval. Higher-volume host
diagnostics can be rate-limited. Job output and runner telemetry remain the
durable source of truth.

The image writes `/var/lib/shipfox/boot-complete` after the environment path gate
has validated the runner environment and activated the lifecycle. The marker
survives a reboot while the instance volume exists. Host journal data and the
marker disappear when the instance is terminated with its root volume.

### Image freshness

The image does not update packages after the bake. CI builds a candidate on each
successful normal merge to `main`, and candidates expire after 14 days.

Release promotion should happen at least weekly. When a candidate is stale,
rebuild or republish it and investigate the release promotion path before using
an older image.

## Environment contract

The provider owns the values and must never bake them into the image. On EC2,
`shipfox-bootstrap.service` reads the raw user data from IMDSv2, validates it, and stages
the complete file at `/etc/shipfox/runner.env.tmp` with mode `0600` and root ownership.
The bootstrap grows the root filesystem when the launch volume exceeds the AMI snapshot.
It prepares the disposable workspace volume. It atomically renames the file into
`/etc/shipfox/runner.env` on the same filesystem. The image watches the final path and
starts the lifecycle target when it appears. Invalid or unavailable user data therefore
never reaches the runner environment gate.

The provider-rendered environment contains:

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

`shipfox-runner.service` powers off immediately when the runner exits. Its SIGTERM drain budget is 90 seconds, after which systemd can force-kill the process and the backend re-reserves the job. Once the environment file is published, `shipfox-max-lifetime.service` schedules a forced poweroff and falls back to a baked 3600-second limit when the configured value is missing or malformed. The configured lifetime therefore includes boot and enrollment skew and must remain comfortably above one job's maximum duration. AWS builds also enable a Spot IMDSv2 watcher that stops the runner, allows it to drain briefly, then powers off.

With `InstanceInitiatedShutdownBehavior=terminate` and Spot `InstanceInterruptionBehavior=terminate`, provider-side settings convert these poweroffs into EC2 termination. The in-guest watchdog is the fast path. The durable backstop remains tagged-instance reconciliation, the backend staleness reaper, and terminate-on-shutdown because privileged job steps or a wedged kernel can defeat an in-guest timer.

## Recovery drill

On EC2, launch a runner with a short max lifetime, stop the provisioner, and verify the instance terminates before that bound. For Spot, request an interruption notice in a test environment and verify the runner stops claiming work, drains, and powers off before reclaim. These drills feed the deployment runbook for the EC2 provisioner.

## Candidate builds

After every successful merge to `main`, CI builds one candidate AMI per architecture in the candidate AWS account. Candidates are not releases: CI shares them only with the configured worker-plane accounts and publishes one immutable OCI manifest at the full source revision. There is no moving `latest` or `main` pointer.

The candidate command writes its AMI ID, architecture, region, owner, creation time, expiration time, source SHA, and whether it built or reused the image to its required `--output` JSON file. The AMI tags are the discovery contract. Internal users resolve an available image by its exact source SHA and architecture with `shipfox.managed=true`, `shipfox.lifecycle=candidate`, `shipfox.candidate_id`, `shipfox.revision`, and `shipfox.architecture`. Candidates are encrypted with `BUILD_CANDIDATE_KMS_KEY_ID`, shared with the comma-separated or JSON-array account IDs in `BUILD_CANDIDATE_CONSUMER_ACCOUNT_IDS`, and retain the 14-day expiry.

CI assumes `AWS_RUNNER_IMAGE_ROLE_ARN` through GitHub OIDC. Repository variables `AWS_RUNNER_IMAGE_CANDIDATE_KMS_KEY_ID` and `AWS_RUNNER_IMAGE_CANDIDATE_CONSUMER_ACCOUNT_IDS` supply the candidate distribution inputs; account IDs are intentionally not Packer source defaults. The role must belong to the candidate account and trust only `ShipfoxHQ/shipfox` builds from `main`. Candidate AMIs must not be used by production provisioning.

QEMU output is test-only and is not published as a distributed artifact. The supported consumer path is a local or CI build followed by a boot test:

```sh
BUILD_ARCH=amd64 BUILD_ATTEMPT=1 BUILD_NUMBER=42 BUILD_RUNNER_VERSION=0.1.0 pnpm --filter=@shipfox/runner-image exec node ./bin/build-runner-image.js ubuntu24 qemu
```

The automated QEMU boot and watchdog suite is tracked in ENG-1022.
