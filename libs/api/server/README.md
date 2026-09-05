# Shipfox API Server

Runs a Shipfox API server.

## What it does

- **`defaultModules()`**: Returns the standard module list.
- **`DefaultAgentModuleOptions`**: Configures the standard Agent module while `defaultModules()` supplies its Secrets and Workflows clients.
- **`DefaultAuthModuleOptions`**: Configures the standard Auth module while `defaultModules()` supplies its Workspaces client.
- **`DefaultRunnersModuleOptions`**: Configures the standard Runners module while `defaultModules()` supplies its Auth client.
- **`DefaultAgentModuleFactory`**, **`DefaultAuthModuleFactory`**, and **`DefaultRunnersModuleFactory`**: Full module replacement escape hatches.
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

To configure the standard Auth module with an application-specific signup
policy, use `authModuleOptions`. The composition root keeps ownership of the
Workspaces client and the module lifecycle:

```ts
const modules = await defaultModules({
  authModuleOptions: {signupPolicy},
});
```

To configure the standard Agent module with a managed provider, use
`agentModuleOptions`. `defaultModules()` calls `createAgentModule` with the
managed provider and every composition-owned dependency:

```ts
const modules = await defaultModules({
  agentModuleOptions: {managedProvider},
});
```

To configure installation provisioning in the standard Runners module, use
`runnersModuleOptions`:

```ts
const modules = await defaultModules({
  runnersModuleOptions: {installationProvisioning: {policy}},
});
```

Use `agentModuleFactory`, `authModuleFactory`, or `runnersModuleFactory` only
when replacing a complete module. A replacement factory owns equivalent
validation and must preserve the module contract and forward every dependency
it needs. The legacy `agentModule`, `authModule`, and `runnersModule` factory
options remain supported as deprecated aliases. Migrate configuration-only
factories to the matching `*ModuleOptions` field.

A replacement Auth module must register `AUTH_AGENT_ACCESS`, including
`createAgentAccessAuthMethod` from `@shipfox/api-auth` in its auth methods. The
default MCP route requires that method to authenticate agent-access credentials.

The standard Agent module validates its configuration during composition. Its
additive options cannot provide or replace the composition-owned Secrets and
Workflows clients. The returned standard module therefore keeps the
Workflows-backed session transcript routes mounted. An options object whose
fields are all undefined is treated as unconfigured and does not conflict with
a full replacement factory.

Load the instrumentation entry before feature modules:

```sh
node --import @shipfox/api-server/instrumentation ./dist/index.js
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `E2E_ENABLED` | `false` | Enables routes under `/__e2e` when `E2E_ADMIN_API_KEY` is set. |
| `E2E_ADMIN_API_KEY` | none | Required to enable and protect E2E routes. |
| `API_PUBLIC_URL` | none | Required public API origin used by MCP OAuth metadata and redirect flows. Local development may use `http://localhost:16101`; use HTTPS elsewhere. |
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
