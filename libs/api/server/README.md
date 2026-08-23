# Shipfox API Server

Runs a Shipfox API server.

## What it does

- **`defaultModules()`**: Returns the standard module list.
- **`DefaultAgentModuleFactory`**: Builds the Agent module with a scoped Secrets client.
- **`DefaultAuthModuleFactory`**: Builds the Auth module with the composed Workspaces client.
- **`createServer()`**: Builds an API server. The caller owns process signals.
- **`runServer()`**: Starts the server. It listens for SIGTERM and SIGINT.
- **`createLoginMethodsRoute()`**: Builds the public login-method catalog route. `createServer` mounts it automatically.
- **Instrumentation preload**: Starts metrics and optional logs early. Load it before feature modules.

## Installation

```sh
pnpm add @shipfox/api-server
```

## Usage

```ts
import {defaultModules, runServer} from '@shipfox/api-server';

await runServer({modules: await defaultModules()});
```

To add a module that creates sessions, use the composed Workspaces client rather
than creating another inter-module transport:

```ts
const modules = await defaultModules({
  extension: ({workspaces}) => [createCloudModule({workspaces})],
});
```

To provide an Auth module with an application-specific signup policy, use the
Auth factory. Its returned module is included in the standard composition and
its inter-module presentations are registered with the same transport:

```ts
import {createAuthModule} from '@shipfox/api-auth';

const modules = await defaultModules({
  authModule: ({workspaces}) => createAuthModule({workspaces, signupPolicy}),
});
```

To replace the Agent module, use the Agent factory. It receives the composed
Secrets operations used by Agent, and its returned module is included in the
standard composition before presentation registration and transport sealing:

```ts
import {createAgentModule} from '@shipfox/api-agent';

const modules = await defaultModules({
  agentModule: ({secrets}) => createAgentModule({secrets, managedProvider}),
});
```

The standard `createAgentModule` validates Agent configuration during
composition. A custom factory that does not call it owns equivalent validation.
Its module must declare the `agent` database namespace and present the canonical
Agent inter-module contract. The scoped Secrets client exposes only the
operations used by Agent. Treat a custom module as trusted code with access to
those operations.

Load the instrumentation entry before feature modules:

```sh
node --import @shipfox/api-server/instrumentation ./dist/index.js
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `E2E_ENABLED` | `false` | Enables routes under `/__e2e` when `E2E_ADMIN_API_KEY` is set. |
| `E2E_ADMIN_API_KEY` | none | Required to enable and protect E2E routes. |
| `API_PORT` | shared `PORT` | Sets the listener port. |
| `API_TRUST_PROXY` | `false` | Sets proxy IP checks. |

## Behavior notes

- **Custom composition**: Pass a module list to make a custom server. A module must declare a unique `loginMethods` entry. `createServer` throws before startup side effects when no login method is available.
- **Login-method catalog**: Every server composition exposes a public, unauthenticated `GET /auth/login-methods`, listing the bounded IDs of every module-contributed login method.
- **Signal handling**: `createServer` does not install signal handlers.
- **Lifecycle**: `start` starts workers and module services before the HTTP listener. `stop` is safe to call again. It stops services before workers and shared clients.
- **Process scope**: Run one server at a time.

## Development

```sh
turbo build --filter=@shipfox/api-server
turbo check --filter=@shipfox/api-server
turbo type --filter=@shipfox/api-server
turbo test --filter=@shipfox/api-server
```

## License

MIT
