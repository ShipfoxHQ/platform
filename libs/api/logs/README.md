# Shipfox API Logs

Shipfox API Logs is the server-side store for step logs. It accepts an append-only
byte stream from the runner under an offset protocol, enforces a per-job storage
budget, keeps the hot bytes in PostgreSQL, and closes streams when a step ends or its
runner is lost. It serves those logs back on a session-authed read endpoint, and owns its
tables and routes.

## Example

Register the module with the API module runner:

```ts
import {logsModule} from '@shipfox/api-logs';
import {createApp, listen} from '@shipfox/node-fastify';
import {initializeModules} from '@shipfox/node-module';

const {auth, routes} = await initializeModules({
  modules: [logsModule],
});

await createApp({auth, routes});
await listen();
```

This adds:

- log database migrations from `libs/api/logs/drizzle`
- the append route under `/runs/jobs/current/steps/:stepId/logs` (lease-authed)
- the read route under `/steps/:stepId/attempts/:attempt/logs` (session-authed): inline NDJSON
  while the stream is hot, a presigned object URL once it is compacted, plus the canonical
  `SessionView` parsed from stored agent-session rows
- the `logs.stream.closed` publisher and two close subscribers: the step-attempt-terminated
  subscriber that closes each attempt's stream when the runner did not end it in-band, and the
  job-terminated subscriber that force-closes any of a job's still-open streams
- the Temporal lifecycle workers that carry a closed stream through to deletion: compaction to a
  gzip object, plus the compaction-reconcile, stale-open-stream reaper, and retention-sweep crons

## Streams

One stream per `(job, step, attempt)`, scoped by `job_id` (from the lease), so a lease can
only ever reach its own job's streams. There is no per-producer `kind` on the stream: every
record a step emits lives in this one stream, and a reader filters by the record's `type`
(see below) at read time without needing to know anything about the producer.

## The log record contract

One JSON object per line. The shared envelope is `{v, ts}`. The pipe rides on `stream` for
output; control records are flat by `type`:

```ts
{v: 1, ts, type: 'output',        stream: 'stdout' | 'stderr', data}   // <= 16 KiB data
{v: 1, ts, type: 'group_start',   group_id, parent_group_id, name}     // name <= 1 KiB
{v: 1, ts, type: 'group_end',     group_id}
{v: 1, ts, type: 'end',           total_bytes}
{v: 1, ts, type: 'gap',           dropped_bytes}
{v: 1, ts, type: 'agent_session', row}                                // normalized SessionView row
{v: 1, ts, type: 'capped'}        // server-only
{v: 1, ts, type: 'runner_lost'}   // server-only
```

### Write-path protection

Two layers stop a runner from writing what it should not:

1. **Lease scope**: the lease binds writes to the job's own `(step, attempt)`, so cross-job
   injection is structurally impossible.
2. **Distinct raw/write and stored/read unions**: every line is validated against the **raw**
   record union. The server-only `capped`/`runner_lost` tombstones are members of the read union
   only, not the raw write union, so a forged tombstone append is rejected (400). A forged
   tombstone that is otherwise a valid record is logged as a narrowed audit warning (no payload,
   no token).

### Server-origin append

Server-executed steps (the tool step executor) write logs through the inter-module
`appendServerRecords` method on the Logs contract (`@shipfox/api-logs-dto/inter-module`) instead
of the lease-bound route. It runs the same offset CAS, accrual budget, cap, and close semantics,
storing chunks with `origin` `server`; records are already-normalized members of the stored/read
union, so they skip the raw-to-stored normalization the runner path applies. The caller owns no
spool cursor, so each batch lands at the stream tail (the CAS offset is the current committed
length); the in-order CAS still serializes concurrent writers. Streams close through the same
paths as runner streams, including the step-attempt-terminated subscriber.

### Multi-level named groups

`::group::<name>` / `::endgroup::` markers form a tree. The runner keeps a nesting stack: each
`group_start` gets a monotonic id (`g1`, `g2`, …) and a `parent_group_id` (the enclosing group,
or `null` at the root). Nesting is capped at depth 32; past the cap a group is flattened to plain
output and counted so its matching `::endgroup::` never pops a real parent. The tree is
recoverable from the ids, parent links, and the tombstone position at truncation.

## Read path

A session-authed `GET /steps/:stepId/attempts/:attempt/logs?cursor=N` serves one endpoint for both
the live tail and the full history. It is workspace-scoped through the stream row's denormalized
`workspace_id`; a 404 covers both a missing stream and a cross-workspace step, so existence never
leaks.

- **Hot (open, or closed but not yet compacted)**: inline NDJSON read from the Postgres chunks,
  walked by chunk `seq` so server control tombstones interleave with normalized runner records
  exactly as compaction concatenates them, making the inline bytes byte-identical to the
  decompressed object.
  Pages are bounded by `LOG_READ_INLINE_MAX_BYTES`; the client follows `has_more`/`next_cursor` to
  drain the backlog, then tails from the last cursor.
- **Cold (compacted, `object_key` set)**: a presigned GET URL (`LOG_READ_URL_TTL_SECONDS`) so the
  browser fetches the object directly and API egress is bypassed.

## Agent-session capture

An agent step forwards each agent session entry as one `agent_session` record on this **same**
append request, distinguished by its `type`. That append-side record carries the raw entry in
`data`; it is a write contract only. On ingestion, the API parses each accepted entry into one or
more canonical `SessionView` rows and writes those rows back as normal `agent_session` log records
in the same chunk stream (`{v, ts, type: 'agent_session', row}`). The parser is selected from the
step's `config.harness` (`pi` by default).

The transformed records use the same offset-CAS append protocol, chunk table, compaction object,
and `/logs` read endpoint as output records. Retries, gaps, closed-stream drops, and post-cap drops
therefore behave exactly like any other log append: if the chunk is not stored, no normalized
session records appear. A malformed or unsupported harness entry degrades to one `raw` row instead
of failing ingestion or read.

The `/logs` read endpoint returns one stream of log records. `state` and `truncated` come from the
stream row so clients know when polling can stop. The endpoint never parses session entries on
read; it serves the normalized records stored by ingestion.

The runner forwards entries opaquely and never splits one across records, so a record always
carries a whole entry. Per-entry size is bounded by `LOG_MAX_SESSION_LINE_BYTES` (a larger line is
rejected with 400, and the runner drops it with a `gap`); the request body limit
(`LOG_APPEND_BODY_LIMIT_BYTES`) must hold a full line plus framing, enforced by a startup invariant.

## Budget and terminal state

One shared, job-wide, generous accrual budget covers a job's logs. When the job's stored bytes
cross the budget, the job is capped and further appends are dropped. The append that crosses the
budget is stored in full, then an in-band `capped` tombstone record is injected once; later appends
are accepted-and-dropped. The cap is a **job-level** signal: a stream can be byte-complete and
still sit under a capped job if a sibling step exhausted the shared budget.

A stream closes on one of four triggers, all converging on the same guarded, exactly once close:
the runner declares its end in-band (an `end` record in an append), which closes the stream
`declared` the moment those bytes commit; the step-attempt-terminated subscriber closes an attempt
the runner never ended in-band, `declared` when the runner drained its spool or `timeout` when it
abandoned it (carried on the event's `logOutcome`); the job-terminated sweep force-closes any of a
job's still-open streams once the job goes terminal, after a grace period
(`LOG_STREAM_CLOSE_GRACE_SECONDS`); and the reaper cron force-closes any stream still open past the
lease window (`LOG_STREAM_REAP_AFTER_SECONDS`), the backstop for a stream the one-shot sweeps missed
(one whose first append landed after they ran). Every timeout close sets `truncated` and injects a
`runner_lost` tombstone; each close writes one `logs.stream.closed` event, which drives compaction.

## Setup

Install the package from the registry:

```sh
pnpm add @shipfox/api-logs
```

Configuration lives in `src/config.ts` (object storage for compacted logs, the per-job budget,
the close grace period, the append body limit, and the read path's presigned-URL TTL and inline
page cap). See each variable's `desc` for what to set.
