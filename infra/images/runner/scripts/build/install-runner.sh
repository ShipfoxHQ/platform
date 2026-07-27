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
cd /opt/runner
node --input-type=module -e 'const {createRequire} = await import("node:module"); const {realpathSync} = await import("node:fs"); const {pathToFileURL} = await import("node:url"); const require = createRequire(realpathSync("/opt/runner/node_modules/@shipfox/runner-orchestration/dist/index.js")); const {assertPiHarnessExtensionsAvailable} = await import(new URL("./core/pi-extensions.js", pathToFileURL(require.resolve("@shipfox/runner-agent")))); assertPiHarnessExtensionsAvailable();'
chown -R shipfox:shipfox /opt/runner
