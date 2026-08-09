#!/usr/bin/env sh
set -eu

root_dir=${RUNNER_IMAGE_ROOT:-/}
workspace="$root_dir/tmp/shipfox-runner-workspace"
lockfile="$(find "$workspace" -name pnpm-lock.yaml -print -quit)"
if [ -z "$lockfile" ]; then
  echo 'Pruned runner workspace has no pnpm lockfile.' >&2
  exit 1
fi
cd "$(dirname "$lockfile")"
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile
pnpm --filter=@shipfox/runner deploy --prod --legacy --config.strict-peer-dependencies=false /opt/runner
# Verify the deployed production closure contains every Pi extension entry before the image is
# published. This runs against the deployed flat layout, not the pnpm development tree.
node /opt/runner/dist/verify-installation.js
chown -R shipfox:shipfox /opt/runner

# Ubuntu's tmpfiles.d/tmp.conf applies `D /tmp 1777 root root 30d` during boot.
# Remove the dependency tree before the AMI is snapshotted so tmpfiles does not
# recursively walk the build staging area on every runner start.
rm -rf "$workspace"
if [ -e "$workspace" ]; then
  echo "Runner image staging workspace remains after cleanup: $workspace" >&2
  exit 1
fi
