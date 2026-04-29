# Shipfox OpenTelemetry

OpenTelemetry setup for Shipfox Node services. It starts tracing, Prometheus metrics, Fastify tracing, and trace-aware logging helpers.

## What it does

- **`startInstanceInstrumentation(options)`** starts the OpenTelemetry Node SDK.
- **`getFastifyInstrumentation()`** returns the Fastify tracing plugin.
- **`startServiceMetrics(options?)`** starts a separate provider for app metrics.
- **`getServiceMetricsProvider()`** returns the app metrics provider.
- **`instanceMetrics`** re-exports OpenTelemetry `metrics`.
- **`logger(options?)`** returns a logger with active trace IDs when a span exists.
- **`shutdownInstrumentation()`** shuts down tracing and metrics.

Environment variables (via `@shipfox/config`):

- `OTEL_SERVICE_NAME` is optional if you pass `serviceName` in code.
- `TRACES_COLLECTOR_URL` is optional. Set it to send traces over OTLP HTTP.
- `OTEL_INSTANCE_METRICS_PORT` defaults to `9464`.
- `OTEL_SERVICE_METRICS_PORT` defaults to `9474`.
- `OTEL_DIAG_LOG_LEVEL` defaults to `none`.

Default metrics endpoints:

- Instance metrics use `:9464/metrics`.
- Service metrics use `:9474/metrics`.

## Installation

```bash
pnpm add @shipfox/node-opentelemetry
# or
yarn add @shipfox/node-opentelemetry
# or
npm install @shipfox/node-opentelemetry
```

## Quick start

```ts
import {
  startInstanceInstrumentation,
  shutdownInstrumentation,
  instanceMetrics,
} from "@shipfox/node-opentelemetry";

startInstanceInstrumentation({
  serviceName: "billing-api",
  exporter: {
    instance: {port: 9464, endpoint: "/metrics"},
    service: {port: 9474, endpoint: "/metrics"},
  },
});

process.on("SIGTERM", async () => {
  await shutdownInstrumentation();
  process.exit(0);
});

const meter = instanceMetrics.getMeter("billing-api");
const requestCounter = meter.createCounter("http_requests_total");

function onRequestHandled() {
  requestCounter.add(1, { route: "/invoices", method: "GET" });
}
```

## Service-level custom metrics

Use a separate provider for app metrics:

```ts
import { getServiceMetricsProvider } from "@shipfox/node-opentelemetry";

const provider = getServiceMetricsProvider();
const meter = provider.getMeter("billing-service");

const queueDepth = meter.createObservableGauge("queue_depth");
meter.addBatchObservableCallback((observableResult) => {
  observableResult.observe(queueDepth, 42, { queue: "invoices" });
});
```

## Traces (OTLP over HTTP)

Set `TRACES_COLLECTOR_URL` to send traces to an OTLP HTTP endpoint. Leave it unset to disable trace export.

## Configuration via environment

```bash
export OTEL_SERVICE_NAME="billing-api"
export TRACES_COLLECTOR_URL="http://otel-collector:4318/v1/traces"
export OTEL_INSTANCE_METRICS_PORT="9464"
export OTEL_SERVICE_METRICS_PORT="9474"
```

You can also set metrics ports in code with `startInstanceInstrumentation` options.

## Development

```sh
turbo check --filter=@shipfox/node-opentelemetry
turbo type --filter=@shipfox/node-opentelemetry
turbo test --filter=@shipfox/node-opentelemetry
```

## License

MIT
