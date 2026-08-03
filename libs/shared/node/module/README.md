# Shipfox Module

Module setup helpers for Shipfox API services. A module can list its database, request auth, login methods, routes, outbox publishers, event handlers, service metrics, Temporal workers, and long-running services in one object.

## What it does

- **`initializeModules({modules})`**: Sets up modules in array order.
- **`registerModuleMetrics({modules})`**: Registers service-level metrics for modules that declare a metrics hook.
- **`runModuleStartupTasks({modules})`**: Runs module startup tasks in declaration order after initialization.
- **`startModuleWorkers({workers})`**: Creates Temporal workers and returns a handle that drains workers and closes their Temporal resources.
- **Worker activity metrics**: Record execution, failures, retries, and latency with bounded module, task queue, activity, and outcome labels.
- **`startModuleServices({services})`**: Starts long-running services and returns a handle that stops them within their declared timeouts.
- **`ShipfoxModule`**: Module contract used by API packages.
- **`loginMethods`**: Declares user-facing ways to establish a Shipfox session.
- **`aggregateLoginMethods({modules})`**: Checks that a composition has one or more unique login method identifiers.
- **Publisher registry**: Adds outbox tables, drains pending events, and marks events as sent.
- **Subscriber registry**: Adds and reads in-process event handlers by event type.

## Usage

```ts
import {createApp, listen} from '@shipfox/node-fastify';
import {
  initializeModules,
  registerModuleMetrics,
  runModuleStartupTasks,
  startModuleServices,
  startModuleWorkers,
} from '@shipfox/node-module';

const modules = [{name: 'example'}];
const {auth, routes, services, workers} = await initializeModules({
  modules,
});
registerModuleMetrics({modules});
await runModuleStartupTasks({modules});

await createApp({auth, routes});
const moduleWorkers = await startModuleWorkers({workers});
const moduleServices = await startModuleServices({services});
await listen();
```

`initializeModules` runs module migrations first. It exposes auth methods and
routes after that. Module order controls migration and initialization. It does
not grant access to another module's tables. Call `registerModuleMetrics` after
instrumentation starts and all migrations finish. Observable gauges can then
query their owning module's storage.
Worker and service startup failures reject before serving traffic. Call `runModuleStartupTasks` after initialization so migrations complete first. The returned worker handle is idempotent and stops workers before releasing the shared Temporal connection and client. A service handle is also idempotent. It stops services in reverse order and bounds each stop with the service timeout.

## Module Shape

```ts
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';

interface ExampleEventMap {
  'example.created': {id: string};
}

const subscriber = subscriberFactory<ExampleEventMap>();

async function handleExampleCreated(payload: ExampleEventMap['example.created']): Promise<void> {
  console.log(payload.id);
}

export const exampleModule: ShipfoxModule = {
  name: 'example',
  database: {db, migrationsPath, databaseNamespace: 'example'},
  auth: [authMethod],
  loginMethods: [{id: 'example-login'}],
  routes: [routes],
  metrics: registerExampleServiceMetrics,
  startupTasks: warmExampleCache,
  publishers: [{name: 'example', table: outbox, db}],
  subscribers: [subscriber('example.created', handleExampleCreated)],
  workers: [{taskQueue: 'example', workflowsPath, activities, workflows: []}],
  services: [
    {
      name: 'example-poller',
      shutdownTimeoutMs: 10_000,
      start: async () => ({stop: async () => undefined, finished: new Promise(() => undefined)}),
    },
  ],
};
```

Every database declaration requires a stable lowercase snake-case
`databaseNamespace`. Initialization uses it for the Drizzle migration history
table `__drizzle_migrations_<databaseNamespace>` and rejects invalid or
duplicate namespaces before running migrations.

## Login methods

A server composition must declare at least one login method. Server construction fails when none are declared. The error explains how to add a module contribution.

External identity modules contribute their own stable identifier:

```ts
import type {ShipfoxModule} from '@shipfox/node-module';

export const acmeSsoModule: ShipfoxModule = {
  name: 'acme-sso',
  loginMethods: [{id: 'acme-sso'}],
};
```

Each identifier has one owning module. Duplicate identifiers fail during server construction. A module that contributes a login method must also create a login-ready session for a verified, active user.

## Inter-module transport

`@shipfox/node-module/inter-module` is the instance-owned in-memory transport for calls between bounded contexts. It builds on the browser-safe contract primitives in [`@shipfox/inter-module`](../../common/inter-module/README.md).

```ts
import {createInterModuleClient, defineInterModuleContract, defineInterModulePresentation} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport, registerInterModulePresentations} from '@shipfox/node-module/inter-module';

const transport = createInMemoryInterModuleTransport();

// Clients can be created before presentations, so two modules can call each
// other without a code import cycle.
const widgets = transport.createClient(widgetsInterModuleContract);
const orders = transport.createClient(ordersInterModuleContract);

const modules = [createWidgetsModule({clients: {orders}}), createOrdersModule({clients: {widgets}})];

registerInterModulePresentations({transport, modules});
transport.seal(); // rejects a client whose module never got a presentation registered
```

`createClient`/`register` reject a duplicate or mismatched-contract-object call
immediately, without recording anything: the rejected call never corrupts the
graph, so fixing the caller and retrying that same call is always enough to
recover.

A module declares its producer presentations on `ShipfoxModule.interModulePresentations`; `registerInterModulePresentations` registers all of them in array order. `@shipfox/node-module/inter-module/testing` builds a fake client per named presentation for callers under test, without depending on Vitest:

```ts
import {createFakeInterModuleClients} from '@shipfox/node-module/inter-module/testing';

const clients = createFakeInterModuleClients({
  widgets: defineInterModulePresentation(widgetsInterModuleContract, {
    getWidget: ({id}) => ({id, name: 'Fake widget'}),
  }),
});
```

## Development

```sh
turbo check --filter=@shipfox/node-module
turbo type --filter=@shipfox/node-module
turbo test --filter=@shipfox/node-module
```

## License

MIT
