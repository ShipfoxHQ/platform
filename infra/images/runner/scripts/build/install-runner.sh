#!/usr/bin/env sh
set -eu

workspace=/tmp/shipfox-runner-workspace
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
