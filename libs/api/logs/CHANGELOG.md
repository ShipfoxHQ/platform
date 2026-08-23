# @shipfox/api-logs

## 13.1.0

### Patch Changes

- Updated dependencies [0d3c2e3]
  - @shipfox/api-workflows-dto@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [af6b31e]
  - @shipfox/api-workflows-dto@13.0.0

## 12.7.0

### Patch Changes

- Updated dependencies [4df5e37]
  - @shipfox/api-workflows-dto@12.7.0

## 12.6.0

### Patch Changes

- Updated dependencies [53b87f0]
  - @shipfox/api-workflows-dto@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [5b1838c]
  - @shipfox/api-workflows-dto@12.5.0

## 12.3.0

### Patch Changes

- Updated dependencies [4b0731e]
  - @shipfox/api-workflows-dto@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [ce0984d]
  - @shipfox/api-workflows-dto@12.2.0
  - @shipfox/workflow-document@3.0.1
  - @shipfox/node-opentelemetry@0.6.4
  - @shipfox/node-fastify@0.4.2
  - @shipfox/node-module@1.0.6
  - @shipfox/node-temporal@0.4.5
  - @shipfox/api-auth-context@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [312a137]
  - @shipfox/api-workflows-dto@12.1.0

## 12.0.0

### Patch Changes

- f78740d: Remove Unicode dash punctuation from package prose and source comments.
- Updated dependencies [ee2ce67]
- Updated dependencies [e95fdf4]
- Updated dependencies [f7939c7]
- Updated dependencies [f78740d]
- Updated dependencies [dea1ffd]
- Updated dependencies [adf07e7]
- Updated dependencies [3f781ee]
- Updated dependencies [285fff2]
- Updated dependencies [e44a279]
- Updated dependencies [f13e8bb]
- Updated dependencies [54c820e]
- Updated dependencies [35a42bd]
- Updated dependencies [d77baaa]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [cb0abfa]
- Updated dependencies [7f90b0c]
  - @shipfox/workflow-document@3.0.0
  - @shipfox/api-workflows-dto@12.0.0
  - @shipfox/api-logs-dto@12.0.0
  - @shipfox/node-fastify@0.4.1
  - @shipfox/node-module@1.0.5
  - @shipfox/node-postgres@0.5.0
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-outbox@0.2.6

## 11.0.0

### Major Changes

- 25158c8: Carry workspace lifecycle status in JWT membership claims and enforce suspended or inactive access at the stateless workspace gate while keeping access-token verification stateless.

  `getAuthenticatedSessionContext()` now reads refresh-session metadata from verified access-token claims without checking active refresh-session state; revoking a refresh session does not invalidate an already-issued access token.

### Patch Changes

- Updated dependencies [25158c8]
  - @shipfox/api-auth-context@11.0.0

## 10.2.0

### Minor Changes

- 57e69d8: Stop treating benign Claude SDK message types as unknown session-parser failures.

### Patch Changes

- aaa0962: Cover Claude hook responses while adding drift detection against the installed SDK message union.
- Updated dependencies [57e69d8]
  - @shipfox/api-logs-dto@10.2.0
  - @shipfox/api-auth-context@10.2.0

## 10.1.0

### Minor Changes

- 0760f79: Name and tone Claude session events that carry useful signal.

### Patch Changes

- @shipfox/api-auth-context@10.1.0

## 10.0.0

### Minor Changes

- 930e3e7: Report repeated Claude turns as turn boundaries and distinguish workflow-output re-prompts from user messages.
- dcce9cb: Drop pure-progress Claude session events before storing normalized log rows.

### Patch Changes

- Updated dependencies [74f9e31]
- Updated dependencies [22bf8a2]
  - @shipfox/node-fastify@0.4.0
  - @shipfox/api-workflows-dto@10.0.0
  - @shipfox/api-auth-context@10.0.0
  - @shipfox/node-module@1.0.4
  - @shipfox/api-logs-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-postgres@0.4.4
  - @shipfox/node-temporal@0.4.4
  - @shipfox/workflow-document@2.1.3

## 9.3.0

### Patch Changes

- Updated dependencies [4425c6d]
- Updated dependencies [6017e56]
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/api-workflows-dto@9.3.0
  - @shipfox/api-auth-context@9.3.0
  - @shipfox/node-fastify@0.3.4
  - @shipfox/node-module@1.0.3
  - @shipfox/node-temporal@0.4.4

## 9.2.0

### Patch Changes

- @shipfox/api-auth-context@9.2.0

## 9.0.3

### Patch Changes

- Updated dependencies [a831b32]
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-fastify@0.3.3
  - @shipfox/node-module@1.0.2
  - @shipfox/node-temporal@0.4.3
  - @shipfox/api-auth-context@9.0.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-auth-context@9.0.2
  - @shipfox/api-logs-dto@9.0.2
  - @shipfox/api-workflows-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-error-monitoring@0.2.2
  - @shipfox/node-fastify@0.3.2
  - @shipfox/node-module@1.0.1
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-postgres@0.4.4
  - @shipfox/node-temporal@0.4.2
  - @shipfox/workflow-document@2.1.3

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
- Updated dependencies [154e03f]
  - @shipfox/workflow-document@2.1.2
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/api-logs-dto@9.0.1
  - @shipfox/api-workflows-dto@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/node-drizzle@0.3.3
  - @shipfox/node-error-monitoring@0.2.1
  - @shipfox/node-fastify@0.3.1
  - @shipfox/node-module@1.0.0
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-outbox@0.2.5
  - @shipfox/node-postgres@0.4.3
  - @shipfox/node-temporal@0.4.1

## 9.0.0

### Patch Changes

- @shipfox/api-auth-context@9.0.0
- @shipfox/api-logs-dto@5.0.0
- @shipfox/api-workflows-dto@9.0.0
- @shipfox/config@1.2.2
- @shipfox/node-drizzle@0.3.2
- @shipfox/node-error-monitoring@0.2.0
- @shipfox/node-fastify@0.3.0
- @shipfox/node-module@0.5.0
- @shipfox/node-opentelemetry@0.6.0
- @shipfox/node-outbox@0.2.4
- @shipfox/node-postgres@0.4.2
- @shipfox/node-temporal@0.4.0
- @shipfox/workflow-document@2.1.1

## 8.0.0

### Patch Changes

- de559bb: Moves Agent validation policy behind a versioned inter-module catalog and injects it into Definitions normalization.
- b15f3a7: Removes Auth implementation dependencies from consumer test boundaries.
  - @shipfox/api-workflows-dto@8.0.0

## 7.1.0

### Patch Changes

- ac42c96: Adds boundary-owned reporting for unexpected API runtime failures while preserving expected client and provider outcomes.
- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-temporal@0.4.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/api-auth-context@7.1.0

## 6.0.0

### Major Changes

- 23a4dc2: Moves Logs and Integrations to injected Workflows inter-module clients with minimal log and leased agent-tool queries.

### Patch Changes

- 112c0fa: Adds the Auth inter-module token-minting contract and removes Auth implementation and configuration coupling from its consumers.
- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- Updated dependencies [0bb82a4]
- Updated dependencies [23563de]
- Updated dependencies [54ce48b]
- Updated dependencies [f4bc2eb]
- Updated dependencies [c0162b0]
- Updated dependencies [7ac43a4]
- Updated dependencies [a01e917]
- Updated dependencies [8bdc149]
- Updated dependencies [3810996]
- Updated dependencies [23a4dc2]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [81f9544]
  - @shipfox/api-agent-dto@6.0.0
  - @shipfox/api-workflows-dto@6.0.0
  - @shipfox/node-module@0.4.0
  - @shipfox/node-temporal@0.3.2
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-outbox@0.2.4
  - @shipfox/api-auth-context@6.0.0
  - @shipfox/node-fastify@0.2.4

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/api-agent-dto@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-logs-dto@5.0.0
  - @shipfox/api-workflows@5.0.0
  - @shipfox/api-workflows-dto@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-module@0.3.2
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-outbox@0.2.3
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-temporal@0.3.1

## 4.0.0

### Patch Changes

- Updated dependencies [bbba3b7]
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-workflows@4.0.0
  - @shipfox/node-module@0.3.1
  - @shipfox/node-outbox@0.2.2

## 3.0.0

### Patch Changes

- 7a71e7d: Aligns published dependency ranges with the workspace catalog policy.
- 08fc93b: Adds prebuilt production Temporal workflow bundles to API packages and removes runtime workflow compilation.
- Updated dependencies [3976f8c]
- Updated dependencies [c5ee18f]
- Updated dependencies [7a71e7d]
- Updated dependencies [08fc93b]
  - @shipfox/node-module@0.3.0
  - @shipfox/node-temporal@0.3.0
  - @shipfox/api-workflows@3.0.0
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/api-agent-dto@3.0.0
  - @shipfox/node-fastify@0.2.2
  - @shipfox/api-auth-context@3.0.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [0cd6dd4]
- Updated dependencies [a68458a]
- Updated dependencies [6eba800]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-module@0.2.0
  - @shipfox/node-temporal@0.2.0
  - @shipfox/api-agent-dto@2.0.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-logs-dto@2.0.0
  - @shipfox/api-workflows@2.0.0
  - @shipfox/api-workflows-dto@2.0.0
  - @shipfox/config@1.2.1
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-outbox@0.2.1
  - @shipfox/node-postgres@0.4.1

## 0.1.2

### Patch Changes

- Updated dependencies [705dd43]
  - @shipfox/node-outbox@0.2.0
  - @shipfox/api-workflows@0.1.2
  - @shipfox/node-module@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/api-workflows@0.1.1
  - @shipfox/node-module@0.1.1
  - @shipfox/node-outbox@0.1.1

## 0.1.0

### Minor Changes

- a56748d: Adds ingestion-time agent session parsing with a stored canonical SessionView read endpoint and workflow harness lookup.
- f92122b: Adds the logs module foundation: a stateless monolith module with its own schema, the runner-facing offset-CAS append endpoint (job-lease authenticated, idempotent, multi-instance safe), a per-job accrual budget with a cap tombstone, and an S3-compatible client targeting Garage at startup. The NDJSON v1 record contract lives in the new `@shipfox/api-logs-dto` package, and `@shipfox/node-fastify` gains a `createRawBodyPlugin({contentType, bodyLimit})` factory for byte-exact request bodies.
- 4207772: Add the session-authenticated log read endpoint: `GET /steps/:stepId/attempts/:attempt/logs?cursor=N`. One cursor endpoint serves both the live tail and the full history of a step attempt, workspace-scoped through the stream row's denormalized `workspaceId` (a 404 covers both a missing stream and a cross-workspace step, so existence never leaks).
  - Open or closed-but-uncompacted streams return inline NDJSON read from the hot Postgres chunks, walked by chunk `seq` so server-injected control tombstones (`capped`, `runner_lost`) interleave with runner bytes exactly as compaction concatenates them. The inline bytes are therefore byte-identical to the decompressed compacted object. Pages are bounded by `LOG_READ_INLINE_MAX_BYTES` (default 1 MiB), with a `has_more` flag and a `next_cursor` the client drains before it tails.
  - Compacted streams (`object_key` set) return a presigned GET URL (`LOG_READ_URL_TTL_SECONDS`, default 3600) plus `total_bytes`, `expires_at`, and `truncated`, so the browser fetches the object directly and API egress is bypassed.
  - `@shipfox/api-logs-dto` gains `readLogsQuerySchema` and the `readLogsResponseSchema` discriminated union (`inline` or `presigned`) so the backend, client, and E2E helpers share one contract. `@shipfox/api-logs` adds the `@aws-sdk/s3-request-presigner` dependency.

### Patch Changes

- 68e4022: Collapse the log stream `kind` into one stream per `(job, step, attempt)`. `kind` was modeled at the wrong layer: the runner already funnels every record through one spool and one offset axis, so the per-kind split (separate stream rows, identity, and ingest dispatch) was unnecessary server-side modeling. A reader now pulls every record for a step attempt and filters by the record `type` at read time, without passing a kind.
  - The append request drops the `kind` query param and `LogStreamClosedEvent` drops `kind`. `streamKind`/`StreamKind` and the `agent_session` line validator (`parseSessionLine`) are removed.
  - `attempt_streams` identity becomes `(job, step, attempt)`; the `kind` and now-dead `capped` columns are dropped (budget cap is signaled in-band by a `capped` tombstone and tracked in `job_accounting`). The close path injects `capped`/`runner_lost` tombstones uniformly.
  - `LOG_MAX_SESSION_LINE_BYTES` is removed and `LOG_APPEND_BODY_LIMIT_BYTES` is right-sized to 1 MiB. The runner's flush-window comment is corrected to match (the server body limit is now 1 MiB, no longer 8 MiB).

  Agent-session capture (its own record `type`(s) and runner producer) is deferred to the agent-sessions feature, which will emit those records into this same stream.

- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- d49ee4c: Forward agent step session entries into the logs module as opaque `agent_session` records: the runner tails the pi session file and forwards each verbatim entry over a shared log-stream sink, and the write path stores them with a configurable per-line size cap sized for inline base64 content.
- 8cab4e7: Close a log stream so it becomes eligible for compaction. A committed `end` record declared-closes the stream inside the append transaction, and a `WORKFLOWS_JOB_TERMINATED` subscriber arms a grace-then-close Temporal workflow that force-closes any stream the runner never ended (appending a `runner_lost` tombstone and marking it truncated). Both paths route through one guarded close that writes a single `logs.stream.closed` outbox event, and a closed-stream guard drops later appends. Adds `closed_at` and three partial indexes to the stream table.
- b4103b5: Delete expired logs from both object storage and Postgres on an hourly cron, with a configurable horizon (`LOG_RETENTION_DAYS`, default 90), enforced by our own worker rather than bucket lifecycle rules so behavior is identical across object stores. A retention sweep drains closed streams past the horizon in batches, bounded by a self-imposed time budget so a timed-out run never overlaps the next; per stream it first hard-deletes the row (chunks cascading), guarded on the observed `object_key` so a concurrent compaction publish is left intact, then deletes the whole attempt object prefix (reclaiming orphan leaves left behind by a losing compaction attempt). Failed or raced rows are skipped for the rest of the run so a poison row cannot starve the streams behind it, and a `job_accounting` row is pruned only when its job has no remaining streams and no recent activity, so a live job's budget is never reset.
- b0a0e1a: Reap log streams that leak open after the one-shot job-terminated close. That sweep snapshots a job's open streams once, so a stream whose first append lands after it ran was never closed and leaked forever: open streams are invisible to compaction and retention (both keyed on `state = 'closed'`). A new `reapStaleOpenStreamsCron` (every 10 minutes, on the logs lifecycle queue, staggered off the retention sweep) force-closes any stream left open past the job-lease window, marking it truncated so it re-enters the compaction and retention lifecycle. Adds the `LOG_STREAM_REAP_AFTER_SECONDS` config (default 7200s; startup validates it exceeds the configured `AUTH_JOB_LEASE_TOKEN_EXPIRES_IN`, read from auth's `config`) and the `logs_attempt_streams_open_age_idx` partial index.
- 2883ab4: Add a stream `kind` to the logs contract and harden the write path. Streams are now identified by `(job, step, attempt, kind)` with two kinds: `log_stream` (process output) and `agent_session` (verbatim, format-agnostic agent JSONL).
  - The record envelope drops `src` to `{v, ts}`; the stdout/stderr pipe moves to `stream` on output, and control records become a flat `type` discriminator with multi-level named groups (`group_id`/`parent_group_id`, capped depth with overflow flattening).
  - The append validator is split into an appendable union and a read union, so a forged server-only `capped`/`runner_lost` tombstone is rejected. `agent_session` lines are stored verbatim after a whole-line, fatal-UTF-8, JSON-well-formedness check within a configurable line cap; the budget cap never injects an in-band tombstone into a session, and close derives its `capped`/`truncated` flags out of band.
  - The append request carries `kind`; the shared body limit and session line cap are configurable with a startup invariant.

- 4c39cb5: Makes log retention delete object prefixes before stream rows so transient object-storage delete failures leave rows discoverable for a later sweep instead of permanently orphaning billed objects.
- 150f378: Compact a closed log stream's hot Postgres chunks into one gzip-compressed NDJSON object in object storage, record the object key on the stream row, and delete the chunk rows. Compaction is a Temporal workflow started from the `logs.stream.closed` event (deduped per stream) on a dedicated task queue, with a reconcile cron backstop that re-drives any closed stream whose compaction never started or permanently failed. Crash-safe and idempotent: each attempt uploads to its own per-attempt object key and a single-winner publish (atomic object-key set and chunk delete, guarded by `object_key IS NULL`) records exactly one, so a slow or retried attempt can never overwrite a published object; a streamed-vs-table integrity check over chunk count, last seq, and byte total guards the irreversible chunk delete. Keeps Postgres bounded by in-flight work rather than retention.
- 362b3eb: Scope runner log append authorization to the dispatched step attempt carried by the job lease token.
- 3bea87f: Adds a typed `subscriberFactory` that binds each outbox event name to its payload type at construction, so subscriber handlers receive a typed `(payload, event)` and the per-handler `event.payload as X` casts are gone; a private brand makes the factory the only way to build a module subscriber.
- 8ac88f3: Runs the API logs test suite without per-file Vitest module isolation by replacing cached module mocks with explicit test dependencies.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- Updated dependencies [eb40964]
- Updated dependencies [5c18360]
- Updated dependencies [2c156d2]
- Updated dependencies [067a260]
- Updated dependencies [34ba284]
- Updated dependencies [a56748d]
- Updated dependencies [5707d6d]
- Updated dependencies [7a9943d]
- Updated dependencies [f788565]
- Updated dependencies [b9c3f32]
- Updated dependencies [c17dd6e]
- Updated dependencies [a81b68c]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [736249b]
- Updated dependencies [2bc5595]
- Updated dependencies [b1f57d1]
- Updated dependencies [de54da2]
- Updated dependencies [7b175f5]
- Updated dependencies [7ca4c65]
- Updated dependencies [f104ff2]
- Updated dependencies [68e4022]
- Updated dependencies [5bcdbf4]
- Updated dependencies [97162dd]
- Updated dependencies [b694b09]
- Updated dependencies [c47be09]
- Updated dependencies [f9f059e]
- Updated dependencies [940696a]
- Updated dependencies [f98c2be]
- Updated dependencies [e9396c9]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [f92122b]
- Updated dependencies [4207772]
- Updated dependencies [e250c4c]
- Updated dependencies [b525dcd]
- Updated dependencies [d49ee4c]
- Updated dependencies [2883ab4]
- Updated dependencies [857fd73]
- Updated dependencies [a982f20]
- Updated dependencies [aca162b]
- Updated dependencies [998eba3]
- Updated dependencies [5327934]
- Updated dependencies [314e84e]
- Updated dependencies [3afb7e3]
- Updated dependencies [139e3be]
- Updated dependencies [247cbd6]
- Updated dependencies [c652a68]
- Updated dependencies [121b42e]
- Updated dependencies [75520ff]
- Updated dependencies [bf8319f]
- Updated dependencies [795f440]
- Updated dependencies [3dcd751]
- Updated dependencies [c0a883c]
- Updated dependencies [362b3eb]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [9c1c947]
- Updated dependencies [d635979]
- Updated dependencies [3bea87f]
- Updated dependencies [82d22e4]
- Updated dependencies [d69b164]
- Updated dependencies [2fb3e87]
- Updated dependencies [b74f635]
- Updated dependencies [ef1e917]
- Updated dependencies [c6eb2ee]
- Updated dependencies [f9153e8]
- Updated dependencies [2933c33]
- Updated dependencies [6181819]
- Updated dependencies [a8905ed]
- Updated dependencies [e699508]
- Updated dependencies [282e66a]
- Updated dependencies [0dd23a7]
- Updated dependencies [9c149d1]
- Updated dependencies [e1d4972]
- Updated dependencies [f9bf446]
- Updated dependencies [8ecc121]
- Updated dependencies [d7b9596]
  - @shipfox/api-workflows@0.1.0
  - @shipfox/api-workflows-dto@0.1.0
  - @shipfox/api-agent-dto@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-logs-dto@0.1.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/config@1.2.0
