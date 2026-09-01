# Observability

This guide owns the current metrics model for backend code. Read it when you add
an instrument, choose a metric provider, or change instrumentation startup.
Package READMEs own library APIs and local operational setup.

## Use the right metric plane

Metrics use OpenTelemetry and Prometheus through `@shipfox/node-opentelemetry`.
An app starts instrumentation once. Feature packages define and record their
own instruments. Do not add an SDK or exporter to a feature package.

Use instance metrics for events that happen. Counters and histograms are
recorded inline. Each pod exposes them on port 9464. Prometheus sums them.
Use service metrics only for a point-in-time value from shared storage, such as
a queue depth. Observable gauges use port 9474. This stops Prometheus from
summing the same shared value from every pod.

Package-specific metric names, semantics, thresholds, and alert rules belong in
the owning package documentation or an operational runbook. This guide defines
the shared architecture and conventions without cataloging individual metrics.

## Initialize in the required order

Create instance instruments at module load in `src/metrics/instance.ts`. Record
them where the event is known most precisely. `instanceMetrics` is a no-op before
instrumentation. This keeps imports safe in tests. It has no proxy meter, so an
instrument created before startup stays a no-op forever.

Preload instance instrumentation before the app module graph loads. The API uses
[`@shipfox/api-server/instrumentation`](../../libs/api/server/src/instrumentation.ts)
through `--import` in its development and container commands. Do not start it
from inside `run()` after feature modules load.

Service gauges must not bind a port during module import. Create their meter and
callbacks inside `register<Module>ServiceMetrics()` in `src/metrics/service.ts`.
Register that function on the module's `metrics` hook. The app starts the service
provider and invokes module hooks after modules initialize.

```text
src/metrics/
  instance.ts   Counters and histograms, created at module load.
  service.ts    register<Module>ServiceMetrics() for shared-state gauges.
  index.ts      Re-exports the metric modules.
```

## Name and label metrics safely

Use snake_case names prefixed with the module, such as
`runners_job_claimed` or `workflows_pending_runs`. Do not append `_total` to a
counter. Histogram names normally omit a unit suffix when the exporter derives
one. The API Prometheus exporter emits histogram names verbatim, so keep an
explicit suffix when the owning metric contract requires one. Set `unit: 'ms'`
and explicit histogram buckets where they help.

Metric labels must be bounded and low-cardinality. Use an outcome, reason, type,
conclusion, provider, or operating system. Never use an identifier, raw URL, or
error message as a label. Do not label with job, run, workspace, organization,
user, or request IDs. Put per-entity diagnostics in logs or traces instead.

Type the allowed label shape at the instrument definition so each call site is
checked:

```ts
const jobClaimedCount = meter.createCounter<{outcome: 'claimed' | 'empty'}>(
  'runners_job_claimed',
  {description: 'Job claim attempts by outcome'},
);
```

Metrics may be recorded in `core` or `db`, but not in pure row mappers or DTO
converters. A service-gauge callback uses normal package database functions. It
does not use raw database access.

Read the [OpenTelemetry package README](../../libs/shared/node/opentelemetry/README.md)
for the library API, environment settings, exporters, tracing, and logging.
