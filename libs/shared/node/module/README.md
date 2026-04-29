# Shipfox Module

Module setup helpers for Shipfox API services. A module can list its database, auth methods, routes, outbox publishers, event handlers, and Temporal workers in one object.

## What it does

- **`initializeModules({modules})`**: Sets up modules in array order.
- **`startModuleWorkers({workers})`**: Creates Temporal workers and starts declared workflows.
- **`ShipfoxModule`**: Module contract used by API packages.
- **Publisher registry**: Adds outbox tables, drains pending events, and marks events as sent.
- **Subscriber registry**: Adds and reads in-process event handlers by event type.

## Usage

```ts
import {createApp, listen} from '@shipfox/node-fastify';
import {initializeModules, startModuleWorkers} from '@shipfox/node-module';
import {authModule} from '@shipfox/api-auth';

const {auth, routes, workers} = await initializeModules({
  modules: [authModule],
});

await createApp({auth, routes});
await listen();

startModuleWorkers({workers});
```

`initializeModules` runs module migrations first. It exposes auth methods and routes after that. Put modules with shared database needs earlier in the array.

## Module Shape

```ts
import type {ShipfoxModule} from '@shipfox/node-module';

export const exampleModule: ShipfoxModule = {
  name: 'example',
  database: {db, migrationsPath},
  auth: [authMethod],
  routes: [routes],
  publishers: [{name: 'example', table: outbox, db}],
  subscribers: [{event: 'example.created', handler}],
  workers: [{taskQueue: 'example', workflowsPath, activities, workflows: []}],
};
```

## Development

```sh
turbo check --filter=@shipfox/node-module
turbo type --filter=@shipfox/node-module
```

## License

MIT
