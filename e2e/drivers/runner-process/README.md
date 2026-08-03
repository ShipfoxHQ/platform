# @shipfox/e2e-driver-runner-process

Runner capacity for an end-to-end suite. It mints a provisioner token and runs
`@shipfox/provisioner-docker` as a child process, so a suite can provision real
Docker runners the same way production does.

This package owns the `@shipfox/provisioner-docker` workspace dependency. Other
helpers (gitea, workflows) do not depend on it, so they never pull the provisioner
and its Docker client into their graph.

## API

### `mintProvisionerToken(params)`

Calls `POST /workspaces/:workspaceId/provisioners/tokens` and returns the created
token. The `raw_token` field is the value to pass to `startProvisioner`; the API
returns it only once.

The provisioner-token route is user-authed, so `params.userToken` must be a user
session bearer (the `token` from an E2E session), not the shared E2E admin key.

```ts
const token = await mintProvisionerToken({
  workspaceId,
  userToken: session.token,
});
```

### `startProvisioner(params)`

Spawns the provisioner dist (`node .../provisioner-docker/dist/index.js`), appends
its stdout and stderr to `logFile` (keep this file as a CI artifact), and resolves
once the provisioner reports as active for the workspace. It rejects, after killing
the child, if the process exits before it becomes active or the readiness budget
(default 30 s) runs out.

```ts
const handle = await startProvisioner({
  workspaceId,
  userToken: session.token,
  provisionerToken: token.raw_token,
  templatesFile: '/abs/path/to/templates.e2e.yaml',
  logFile: '/abs/path/to/provisioner.log',
  tokenPrefix: token.prefix, // match this provisioner in the active list
  // Optional, for the compose topology the platform suite uses:
  runnerApiUrl: 'http://host.docker.internal:16101',
  dockerNetwork: 'shipfox_default',
  dockerExtraHosts: 'host.docker.internal:host-gateway',
});
```

The provisioner dist must be built first. Under Turbo this is automatic: `test:e2e`
depends on `^build`, and this package depends on `@shipfox/provisioner-docker`.

### `stopProvisioner(handle, options?)`

Sends `SIGTERM` (then `SIGKILL` after a grace period, default 15 s) so the
provisioner reaps its own containers, then removes any container still carrying the
`shipfox.workspace_id=<workspaceId>` label as a backstop. The backstop is
best-effort: a Docker failure is written to stderr, not thrown.

```ts
await stopProvisioner(handle);
```

## Manual verification

Automated coverage lands with the flow workflow E2E suite, which composes these
functions in its `global-setup` / `global-teardown`. There is no unit test for
process spawning because the behavior depends on the provisioner dist, Docker,
signals, and active-runner polling as one system. To verify this package on its own:

```sh
# 1. Infra + a runner image the templates file references, then the API with E2E routes on.
docker compose up -d
turbo image --filter=@shipfox/runner        # loads runner:ci locally
E2E_ENABLED=true pnpm --filter=@shipfox/api dev

# 2. Build the provisioner dist this helper spawns.
turbo build --filter=@shipfox/provisioner-docker
```

Then, from a scratch script (run with the workspace conditions, for example `tsx`):

```ts
import {createUser, createSession} from '@shipfox/e2e-setup-auth';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {mintProvisionerToken, startProvisioner, stopProvisioner} from '@shipfox/e2e-driver-runner-process';

const user = await createUser();
const session = await createSession({user_id: user.user.id});
const workspace = await createWorkspace({userId: user.user.id});

const token = await mintProvisionerToken({workspaceId: workspace.workspace.id, userToken: session.token});
const handle = await startProvisioner({
  workspaceId: workspace.workspace.id,
  userToken: session.token,
  provisionerToken: token.raw_token,
  tokenPrefix: token.prefix,
  templatesFile: new URL('../../../apps/provisioner-docker/templates.example.yaml', import.meta.url).pathname,
  logFile: '/tmp/provisioner.log',
});
console.log('active provisioner:', handle.provisioner);

await stopProvisioner(handle);
```

Confirm the provisioner appeared in the resolved `handle.provisioner`, that
`/tmp/provisioner.log` filled with output, and that after teardown
`docker ps -a --filter label=shipfox.workspace_id=<workspaceId>` lists nothing.
