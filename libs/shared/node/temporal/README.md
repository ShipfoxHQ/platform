# Shipfox Temporal

Temporal client and worker helpers for Shipfox Node services.

## What it does

- **`createTemporalClient()`**: Connects to Temporal and stores one shared client.
- **`temporalClient()`**: Returns the current client or throws if it has not been created.
- **`closeTemporalClient()`**: Closes the Temporal connection.
- **`isTemporalHealthy()`**: Checks the Temporal connection health service.
- **`createTemporalWorkerConnection()`**: Creates a Temporal worker connection for a caller that owns its lifecycle.
- **`createTemporalWorker(options)`**: Creates a worker with Shipfox defaults.
- **`requestTemporalWorkerShutdown(worker)`**: Requests shutdown only when the worker is running.
- **Prebuilt workflow bundles**: Builds and loads production workflow artifacts without bundling at worker startup.
- **OpenTelemetry propagation**: Connects client, workflow, and activity spans through the official Temporal interceptors.
- **Temporal metrics**: Exposes the SDK's native Prometheus metrics from the worker process.

## Installation and setup

```sh
pnpm add @shipfox/node-temporal
```

## Usage

```ts
import {
  createTemporalClient,
  createTemporalWorker,
  createTemporalWorkerConnection,
  requestTemporalWorkerShutdown,
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

To share and close a connection outside the worker, create it explicitly and pass it to each worker:

```ts
const connection = await createTemporalWorkerConnection();
const worker = await createTemporalWorker({
  connection,
  workflowsPath: new URL('./workflows.js', import.meta.url).pathname,
  activities: {syncActivity},
});

const run = worker.run();
requestTemporalWorkerShutdown(worker);
await run;
await connection.close();
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal frontend address. |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace. |
| `TEMPORAL_TASK_QUEUE` | `shipfox` | Default task queue for workers. |
| `TEMPORAL_API_KEY` | none | API key used to connect to Temporal Cloud. Store it as a secret. |
| `OTEL_TEMPORAL_METRICS_PORT` | `9465` | Port that exposes native Temporal Prometheus metrics. |
| `OTEL_SDK_DISABLED` | `false` | Disables Temporal telemetry together with the shared OpenTelemetry SDK. |

## Behavior notes

- Local connections use no authentication or Transport Layer Security (TLS).
- Setting `TEMPORAL_API_KEY` for a `tmprl.cloud` address enables TLS for clients and workers.
- A `tmprl.cloud` address without `TEMPORAL_API_KEY` stops startup with a configuration error.
- A non-Cloud address with `TEMPORAL_API_KEY` also stops startup so the key cannot be sent to it.
- This package does not configure mutual TLS (mTLS) client certificates.
- Production packages run `shipfox-temporal-bundle` after SWC emits a workflow entrypoint. The command writes sibling `*.bundle.js` and `*.bundle.meta.json` files.
- Production workers load the bundle instead of compiling it. Startup fails when an artifact is missing. It also fails when the `@temporalio/worker` version differs from the runtime version.
- Development workers keep using `workflowsPath`. The bundle build includes workflow interceptors. Production workers use those interceptors from the prebuilt bundle.

## Development

```sh
turbo check --filter=@shipfox/node-temporal
turbo type --filter=@shipfox/node-temporal
turbo test --filter=@shipfox/node-temporal
```

## License

MIT
