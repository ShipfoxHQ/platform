# Shipfox OpenTelemetry

Opinionated OpenTelemetry setup for Node services with:

- One-call initialization (traces + instance Prometheus metrics)
- A separate provider for service-level Prometheus metrics
- Sensible defaults and environment-based config

It should be used with other packages from [Shipfox](https://www.shipfox.io/).

## What it does

- **startInstanceInstrumentation(options)**: Boots a NodeSDK with auto-instrumentations, Fastify instrumentation, Prometheus metrics reader, and optional OTLP trace exporter.
- **getFastifyInstrumentation()**: Access the Fastify instrumentation instance created during startup.
- **startServiceMetrics(options?)**: Creates a standalone `MeterProvider` for custom service metrics with its own Prometheus reader.
- **getServiceMetricsProvider()**: Returns the service metrics provider (creates one if missing).
- **instanceMetrics**: Re-export of `@opentelemetry/api` `metrics` for convenience.
- **shutdownInstrumentation()**: Gracefully shuts down instance and service metrics.

Environment variables (via `@shipfox/config`):

- `OTEL_SERVICE_NAME` (optional if you pass `serviceName` in code)
- `TRACES_COLLECTOR_URL` (optional; if set, enables OTLP trace export over HTTP)

Exported ports and endpoints (defaults):

- Instance metrics: `:9464/metrics`
- Service metrics: `:9474/metrics`

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

// Start as early as possible in your process
startInstanceInstrumentation({
  serviceName: "billing-api", // falls back to OTEL_SERVICE_NAME if omitted
  exporter: {
    instance: { port: 9464, endpoint: "/metrics" },
    service: { port: 9474, endpoint: "/metrics" },
  },
});

// Optionally expose a health handler and ensure graceful shutdown
process.on("SIGTERM", async () => {
  await shutdownInstrumentation();
  process.exit(0);
});

// You can still access the global API directly when creating metrics on the instance provider
const meter = instanceMetrics.getMeter("billing-api");
const requestCounter = meter.createCounter("http_requests_total");

function onRequestHandled() {
  requestCounter.add(1, { route: "/invoices", method: "GET" });
}
```

## Service-level custom metrics

Use a dedicated provider (separate port) for application-specific metrics:

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

If `TRACES_COLLECTOR_URL` is set (e.g., to an OTLP endpoint like `http://otel-collector:4318/v1/traces`), the instance instrumentation will export traces via the OTLP HTTP exporter. Leave it unset to disable trace exporting.

## Configuration via environment

```bash
export OTEL_SERVICE_NAME="billing-api"
# Enable OTLP HTTP traces export (optional)
export TRACES_COLLECTOR_URL="http://otel-collector:4318/v1/traces"
# Prometheus endpoints can be adjusted in code via start options
```
