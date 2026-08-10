#!/usr/bin/env sh
set -eu

# The EC2 provisioner always declares its provider in runner.env. QEMU and other
# provider-neutral images do not, so their existing directory-backed workspace
# contract remains unchanged. This guard is deliberately an image/systemd check;
# the runner application only receives a usable workspace directory.
if [ "${SHIPFOX_RUNNER_PROVIDER_KIND:-}" != "ec2" ]; then
  exit 0
fi

workspace_root="${SHIPFOX_RUNNER_WORKSPACE_ROOT:-/var/lib/shipfox/workspaces}"
exec mountpoint -q "$workspace_root"
