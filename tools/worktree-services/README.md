# @shipfox/worktree-services

Shared local services for Shipfox repositories. The package gives each
checkout a stable port block. It also gives each checkout a Docker Compose
project. It works in a normal checkout or a Conductor workspace.

## Quick start

Install the package as a development dependency:

```sh
pnpm add -D @shipfox/worktree-services
```

Create `dev/worktree-services.config.mjs`:

```js
import {
  defineWorktreeServices,
  standardAppEnv,
  standardPorts,
} from '@shipfox/worktree-services';

export default defineWorktreeServices({
  composeFile: 'compose.yml',
  ports: standardPorts,
  compose: {
    services: ['postgres', 'temporal'],
    initCommands: [],
  },
  appEnv({ports}) {
    return {
      ...standardAppEnv(ports),
      API_PORT: String(ports.api),
      VITE_API_URL: `http://localhost:${ports.api}`,
    };
  },
});
```

Add these scripts to `package.json`:

```json
{
  "scripts": {
    "dev:services:up": "shipfox-worktree-services up",
    "dev:services:stop": "shipfox-worktree-services stop",
    "dev:services:status": "shipfox-worktree-services status",
    "dev:services:destroy": "shipfox-worktree-services destroy"
  }
}
```

Run the services:

```sh
pnpm dev:services:up
```

The command writes environment files under `.context/local-services/`. It then
starts the Compose services selected by the repository config.

## Port ranges

The default range is `20000 to 45999`. The package allocates 20-port blocks. Set
a different range in the consuming repository's `mise.toml` when several
repositories run on one machine:

```toml
[env]
SHIPFOX_PORT_RANGE_START = '46000'
SHIPFOX_PORT_RANGE_END = '71999'
```

All repositories share this user-local registry:
`~/.shipfox/shipfox-port-leases.json`. It prevents overlapping blocks. This
also works when configured ranges overlap by mistake. A lease is keyed by the
repository identity and, in Conductor, `CONDUCTOR_WORKSPACE_ID`; a normal
checkout uses its path. The stored workspace path is only the last observed
location, so renaming a Conductor workspace does not change its lease.

## Commands

| Command | Effect |
| --- | --- |
| `shipfox-worktree-services up` | Allocate ports, write environment files, and start services. |
| `shipfox-worktree-services stop` | Stop services and keep their volumes. |
| `shipfox-worktree-services status` | Show the Compose service status. |
| `shipfox-worktree-services destroy` | Remove this workspace's services, volumes, state, and lease. |
| `shipfox-worktree-services cleanup` | Report safely reclaimable leases for missing path-identified checkouts. |
| `shipfox-worktree-services cleanup --apply` | Remove the reported path-identified leases. |

Use `--workspace`, `--root`, or `--config` for explicit workspace and archive
commands. `cleanup` is read-only unless you pass `--apply`.

Conductor leases are released by `destroy`, including the configured archive
script. Cleanup deliberately does not reclaim a Conductor lease from a missing
path: the workspace may have been renamed since it last ran services.

## Public API

- `defineWorktreeServices(config)` validates and returns a repository config.
- `standardPorts` provides offsets for client, API, Postgres, Temporal, docs,
  Garage, Gitea, metrics, Linear, GitHub, and Slack services.
- `standardAppEnv(ports)` creates the standard local application environment.
- `ResolvedPorts`, `StandardPortDefinitions`, `PortRange`, and related config
  types are exported for TypeScript consumers.

## Development

From the Shipfox repository:

```sh
turbo check type build --filter=@shipfox/worktree-services
turbo test --filter=@shipfox/worktree-services
turbo test:external --filter=@shipfox/worktree-services
pnpm run release:preflight
```

## License

MIT
