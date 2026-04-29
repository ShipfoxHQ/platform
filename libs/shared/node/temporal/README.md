# Shipfox Temporal

Temporal client and worker helpers for Shipfox Node services. It keeps connection settings, worker defaults, health checks, and interceptor hooks in one place.

## What it does

- **`createTemporalClient()`**: Connects to Temporal and stores one shared client.
- **`temporalClient()`**: Returns the current client or throws if it has not been created.
- **`closeTemporalClient()`**: Closes the Temporal connection.
- **`isTemporalHealthy()`**: Checks the Temporal connection health service.
- **`createTemporalWorker(options)`**: Creates a worker with Shipfox defaults.
- **Interceptor helpers**: Return client, worker, and workflow settings.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal frontend address. |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace. |
| `TEMPORAL_TASK_QUEUE` | `shipfox` | Default task queue for workers. |

## Usage

```ts
import {
  createTemporalClient,
  createTemporalWorker,
  temporalClient,
} from '@shipfox/node-temporal';

await createTemporalClient();

await temporalClient().workflow.start('syncWorkflow', {
  taskQueue: 'sync',
  workflowId: 'sync-main',
});

const worker = await createTemporalWorker({
  taskQueue: 'sync',
  workflowsPath: new URL('./workflows.js', import.meta.url).pathname,
  activities: {syncActivity},
});

await worker.run();
```

## Development

```sh
turbo check --filter=@shipfox/node-temporal
turbo type --filter=@shipfox/node-temporal
```

## License

MIT
