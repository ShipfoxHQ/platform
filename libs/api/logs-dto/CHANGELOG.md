# @shipfox/api-logs-dto

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 0.1.0

### Minor Changes

- a56748d: Adds ingestion-time agent session parsing with a stored canonical SessionView read endpoint and workflow harness lookup.
- f92122b: Adds the logs module foundation: a stateless monolith module with its own schema, the runner-facing offset-CAS append endpoint (job-lease authenticated, idempotent, multi-instance safe), a per-job accrual budget with a cap tombstone, and an S3-compatible client targeting Garage at startup. The NDJSON v1 record contract lives in the new `@shipfox/api-logs-dto` package, and `@shipfox/node-fastify` gains a `createRawBodyPlugin({contentType, bodyLimit})` factory for byte-exact request bodies.
- 4207772: Add the session-authenticated log read endpoint: `GET /steps/:stepId/attempts/:attempt/logs?cursor=N`. One cursor endpoint serves both the live tail and the full history of a step attempt, workspace-scoped through the stream row's denormalized `workspaceId` (a 404 covers both a missing stream and a cross-workspace step, so existence never leaks).
  - Open or closed-but-uncompacted streams return inline NDJSON read from the hot Postgres chunks, walked by chunk `seq` so server-injected control tombstones (`capped`, `runner_lost`) interleave with runner bytes exactly as compaction concatenates them. The inline bytes are therefore byte-identical to the decompressed compacted object. Pages are bounded by `LOG_READ_INLINE_MAX_BYTES` (default 1 MiB), with a `has_more` flag and a `next_cursor` the client drains before it tails.
  - Compacted streams (`object_key` set) return a presigned GET URL (`LOG_READ_URL_TTL_SECONDS`, default 3600) plus `total_bytes`, `expires_at`, and `truncated`, so the browser fetches the object directly and API egress is bypassed.
  - `@shipfox/api-logs-dto` gains `readLogsQuerySchema` and the `readLogsResponseSchema` discriminated union (`inline` or `presigned`) so the backend, client, and E2E helpers share one contract. `@shipfox/api-logs` adds the `@aws-sdk/s3-request-presigner` dependency.

### Patch Changes

- f104ff2: Add `@shipfox/client-logs`: the record components for the step-log read stream, composing the `@shipfox/react-ui` log primitives. This covers every process and system record (`output`, `group_start`/`group_end`, `end`, `gap`, `capped`, `runner_lost`); `agent_session` is rendered by the agent-sessions surface.
  - `buildLogTree(records)` is a pure transform that reconstructs the group tree from the flat record list. `group_end` closes the matching `group_id` (so a `group_start` dropped under gap/backlog pressure does not mis-nest), record dispatch is an exhaustive switch, and each group node carries a precomputed `hasError` (a `runner_lost` in its subtree, a genuine failure; `stderr` is a channel, not an error) and subtree line count.
  - `OutputLogRow` renders stdout/stderr (stderr gets a subtle left channel rule, not a background tint), `LogGroup` is a collapsible disclosure with running/duration/incomplete affordances and an inset error bar, the system markers render as timeline rows, and `LogView` is the top-level dispatcher with an empty state. Reviewed in a package-local Storybook captured by Argos (`client-logs`).
  - `@shipfox/api-logs-dto` now measures UTF-8 byte length with `TextEncoder` instead of `node:buffer`, so this shared record contract is browser-safe for the client log viewer. Behavior is identical.
  - `@shipfox/react-ui` gains two shared formatters in `utils`: `formatBytes` (new) and `formatDuration` (an ms-span, sub-second sibling to the existing `humanDuration`), so `client-logs` and future packages share one implementation instead of re-rolling them.

- 68e4022: Collapse the log stream `kind` into one stream per `(job, step, attempt)`. `kind` was modeled at the wrong layer: the runner already funnels every record through one spool and one offset axis, so the per-kind split (separate stream rows, identity, and ingest dispatch) was unnecessary server-side modeling. A reader now pulls every record for a step attempt and filters by the record `type` at read time, without passing a kind.
  - The append request drops the `kind` query param and `LogStreamClosedEvent` drops `kind`. `streamKind`/`StreamKind` and the `agent_session` line validator (`parseSessionLine`) are removed.
  - `attempt_streams` identity becomes `(job, step, attempt)`; the `kind` and now-dead `capped` columns are dropped (budget cap is signaled in-band by a `capped` tombstone and tracked in `job_accounting`). The close path injects `capped`/`runner_lost` tombstones uniformly.
  - `LOG_MAX_SESSION_LINE_BYTES` is removed and `LOG_APPEND_BODY_LIMIT_BYTES` is right-sized to 1 MiB. The runner's flush-window comment is corrected to match (the server body limit is now 1 MiB, no longer 8 MiB).

  Agent-session capture (its own record `type`(s) and runner producer) is deferred to the agent-sessions feature, which will emit those records into this same stream.

- d49ee4c: Forward agent step session entries into the logs module as opaque `agent_session` records: the runner tails the pi session file and forwards each verbatim entry over a shared log-stream sink, and the write path stores them with a configurable per-line size cap sized for inline base64 content.
- 2883ab4: Add a stream `kind` to the logs contract and harden the write path. Streams are now identified by `(job, step, attempt, kind)` with two kinds: `log_stream` (process output) and `agent_session` (verbatim, format-agnostic agent JSONL).
  - The record envelope drops `src` to `{v, ts}`; the stdout/stderr pipe moves to `stream` on output, and control records become a flat `type` discriminator with multi-level named groups (`group_id`/`parent_group_id`, capped depth with overflow flattening).
  - The append validator is split into an appendable union and a read union, so a forged server-only `capped`/`runner_lost` tombstone is rejected. `agent_session` lines are stored verbatim after a whole-line, fatal-UTF-8, JSON-well-formedness check within a configurable line cap; the budget cap never injects an in-band tombstone into a session, and close derives its `capped`/`truncated` flags out of band.
  - The append request carries `kind`; the shared body limit and session line cap are configurable with a startup invariant.

- bf8319f: Re-export the schemas through a relative path so the built package loads under a plain Node ESM resolver, not only tsx or vite, which lets Playwright-run E2E suites consume it through `@shipfox/e2e-observe-logs`.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
