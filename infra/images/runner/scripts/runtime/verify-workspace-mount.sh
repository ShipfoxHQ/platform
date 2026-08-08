#!/usr/bin/env sh
set -eu

# Older AMIs and non-EC2 test images do not receive the split-volume marker.
# Keep their existing boot contract while requiring the mount for new EC2 boots.
if [ "${SHIPFOX_RUNNER_WORKSPACE_MOUNT_REQUIRED:-}" != "1" ]; then
  exit 0
fi

workspace_root="${SHIPFOX_RUNNER_WORKSPACE_ROOT:-/var/lib/shipfox/workspaces}"
exec /usr/bin/mountpoint -q "$workspace_root"
