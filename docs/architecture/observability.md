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

## Stale enrolled runner signal

The runners service exposes `runners_enrolled_without_recent_report` on port
9474. It counts running runners with a live control session, no workspace, no
runner session, and a `reported_at` older than the stale-runner grace window.

The gauge uses `RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS` as its grace
window. The default is five minutes. Alert when the value is greater than zero.
Healthy warm-pool runners stay below the threshold because their provisioner
refreshes `reported_at` with each running report. A warm-pool runner that
remains stale after five minutes indicates a reporting or provisioner failure
and is intentionally included in the alert.

## Logs byte volume

The logs service exposes four byte-volume instruments, all with OpenTelemetry
byte units (`By`). `logs_bytes_ingested`, `logs_bytes_stored`, and
`logs_compacted_bytes` are instance-plane counters (port 9464).
`logs_open_chunk_bytes` is the service-plane gauge (port 9474).

The two ingest counters measure different axes and are not equivalents:

* `logs_bytes_ingested` counts raw runner body bytes accepted by the offset-CAS
  as an in-order extension. Retries, gaps, closed-stream appends, and empty
  heartbeats never extend the CAS, so each accepted body counts exactly once,
  including a capped job's accept-and-drop stragglers.
* `logs_bytes_stored` counts normalized durable bytes written to chunk rows:
  before storage, the pipeline parses `agent_session` records into view rows,
  and server-injected `capped`/`runner_lost` tombstones and cap-dropped bodies
  never count. `ingested - stored` is the normalization delta plus
  cap/close drops.
* `logs_compacted_bytes` counts uncompressed log bytes on the single-winner
  compaction publish, so idempotent re-runs never double-count.
* `logs_open_chunk_bytes` is the un-compacted hot volume in Postgres: chunk rows
  of open streams plus closed streams still awaiting compaction. It lives on
  the service plane because the rows sit in shared Postgres, not per-pod state.

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
counter. Do not append a unit suffix to a histogram name. The exporter derives
those suffixes. Set `unit: 'ms'` and explicit histogram buckets where they help.

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
