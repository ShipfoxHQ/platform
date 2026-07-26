# Shipfox OpenTelemetry

OpenTelemetry setup for Shipfox Node services. It starts tracing, OpenTelemetry logs, Prometheus metrics, Fastify tracing, and trace-aware logging helpers.

## What it does

- **`startInstanceInstrumentation(options)`** starts the OpenTelemetry Node SDK.
- **`getFastifyInstrumentation()`** returns the Fastify tracing plugin.
- **`startServiceMetrics(options?)`** starts a separate provider for app metrics.
- **`getServiceMetricsProvider()`** returns the app metrics provider.
- **`instanceMetrics`** re-exports OpenTelemetry `metrics`.
- **`logger(options?)`** returns a logger with active trace IDs when a span exists.
- **`shutdownInstrumentation()`** flushes and shuts down tracing, logs, and metrics.

Environment variables:

- `OTEL_SERVICE_NAME` is optional if you pass `serviceName` in code.
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is the exact OTLP HTTP trace endpoint.
- `OTEL_LOGS_EXPORTER` selects the standard logs exporter. Use `otlp` to export Pino records through OTLP or `none` to disable log export.
- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` is the exact OTLP HTTP logs endpoint. It takes precedence over the signal-independent endpoint.
- `OTEL_EXPORTER_OTLP_ENDPOINT` is the base OTLP endpoint used when a signal-specific endpoint is unset.
- `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_TIMEOUT`, and `OTEL_EXPORTER_OTLP_COMPRESSION` configure all OTLP signals. Their signal-specific `OTEL_EXPORTER_OTLP_TRACES_*` and `OTEL_EXPORTER_OTLP_LOGS_*` variants take precedence.
- `OTEL_EXPORTER_OTLP_PROTOCOL` and `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` select the standard OTLP protocol.
- `OTEL_RESOURCE_ATTRIBUTES` adds or overrides resource attributes such as deployment environment and release identity.
- `OTEL_TRACES_SAMPLER` and `OTEL_TRACES_SAMPLER_ARG` configure the standard SDK sampler.
- `OTEL_SDK_DISABLED` disables tracing, logs, and metrics when set to `true`.
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

## Logs and traces

Pino instrumentation sends records to the OpenTelemetry Logs API while the
original Pino stream continues to receive records for stdout and file targets.
Set `OTEL_LOGS_EXPORTER=otlp` and `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` to export
logs. The SDK batches records and `shutdownInstrumentation()` flushes accepted
records before returning.

Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to an exact OTLP HTTP trace endpoint, or set `OTEL_EXPORTER_OTLP_ENDPOINT` to a base endpoint. Leave both unset to disable trace export.

## Configuration via environment

```bash
export OTEL_SERVICE_NAME="billing-api"
export OTEL_EXPORTER_OTLP_ENDPOINT="http://otel-collector:4318"
export OTEL_LOGS_EXPORTER="otlp"
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT="http://otel-collector:4318/v1/logs"
export OTEL_RESOURCE_ATTRIBUTES="service.version=1.2.3,deployment.environment=production"
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
