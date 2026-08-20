# Linear Context Graph — ENG-1521

Gathered: 2026-08-20 by the context-gathering agent (Shipfox). Source of truth for the implementation agent.

## 1. The issue: ENG-1521

### Raw tool result (linear_shipfox__get_issue, includeReleases + includeRelations + includeCustomerNeeds)

```json
{
  "id": "ENG-1521",
  "title": "Add byte-volume metrics for logs ingestion, storage, and compaction",
  "description": "The logs package currently tracks byte totals in PostgreSQL, but exposes no byte-volume telemetry. `logs_record_appended` counts records rather than bytes.\n\nAdd these metrics:\n\n* `logs_bytes_ingested` — counter, raw runner bytes accepted after offset validation.\n* `logs_bytes_stored` — counter, normalized durable bytes written to log chunks.\n* `logs_open_chunk_bytes` — service gauge, current bytes in un-compacted hot chunks.\n* `logs_compacted_bytes` — counter, bytes successfully compacted to object storage.\n\nRequirements:\n\n* Define raw-ingested versus normalized-stored semantics explicitly.\n* Use OpenTelemetry byte units.\n* Keep counters on the instance metric plane and the hot-storage gauge on the service metric plane.\n* Avoid double-counting retries, gaps, closed streams, and capped jobs.\n* Add tests for successful appends, retries, caps, control records, and compaction.\n\nRelevant implementation areas: `metrics/`, `append-logs.ts`:187, and `compact-stream.ts`:38.",
  "priority": {"value": 0, "name": "No priority"},
  "url": "https://linear.app/shipfox/issue/ENG-1521/add-byte-volume-metrics-for-logs-ingestion-storage-and-compaction",
  "gitBranchName": "shipfox/eng-1521-add-byte-volume-metrics-for-logs-ingestion-storage-and",
  "createdAt": "2026-08-08T09:50:18.306Z",
  "updatedAt": "2026-08-20T11:03:07.960Z",
  "archivedAt": null,
  "completedAt": null,
  "startedAt": "2026-08-09T09:39:03.869Z",
  "canceledAt": null,
  "dueDate": null,
  "slaStartedAt": null, "slaMediumRiskAt": null, "slaHighRiskAt": null, "slaBreachesAt": null,
  "status": "In Progress",
  "statusType": "started",
  "labels": ["repo:shipfox"],
  "attachments": [],
  "documents": [],
  "stateHistory": [
    {"state": {"id": "31db8a83-248d-498a-835b-fb85a156ce0c", "name": "Todo", "type": "unstarted"}, "startedAt": "2026-08-08T09:50:18.306Z", "endedAt": "2026-08-09T09:39:03.880Z"},
    {"state": {"id": "45baa6f4-05cd-4e52-abce-91ccaf0a3b47", "name": "In Progress", "type": "started"}, "startedAt": "2026-08-09T09:39:03.880Z", "endedAt": null}
  ],
  "customerNeeds": [],
  "releases": [],
  "createdBy": "Noé Charmet",
  "createdById": "be099334-9982-41b1-b336-e7b7b741d548",
  "assignee": "Noé Charmet",
  "assigneeId": "be099334-9982-41b1-b336-e7b7b741d548",
  "delegate": "Shipfox",
  "delegateId": "f35cb640-e009-40ba-9ef0-7715c70ba7a8",
  "team": "Engineering",
  "teamId": "d5489d68-e276-4f40-8d1a-83d511b62890",
  "relations": {"blocks": [], "blockedBy": [], "relatedTo": [], "duplicateOf": null}
}
```

Notes: no project, no milestone, no cycle, no attachments, no documents, no releases, no relations, no customer needs on the issue itself. The graph below comes from following the references in the issue description and the prior session comments.

### Task summary (verbatim description)

The logs package currently tracks byte totals in PostgreSQL, but exposes no byte-volume telemetry. `logs_record_appended` counts records rather than bytes.

Add these metrics:

- `logs_bytes_ingested` — counter, raw runner bytes accepted after offset validation.
- `logs_bytes_stored` — counter, normalized durable bytes written to log chunks.
- `logs_open_chunk_bytes` — service gauge, current bytes in un-compacted hot chunks.
- `logs_compacted_bytes` — counter, bytes successfully compacted to object storage.

Requirements:

- Define raw-ingested versus normalized-stored semantics explicitly.
- Use OpenTelemetry byte units.
- Keep counters on the instance metric plane and the hot-storage gauge on the service metric plane.
- Avoid double-counting retries, gaps, closed streams, and capped jobs.
- Add tests for successful appends, retries, caps, control records, and compaction.

Relevant implementation areas: `metrics/`, `append-logs.ts`:187, and `compact-stream.ts`:38.

### Comments on ENG-1521 (linear_shipfox__list_comments, newest first)

All prior comments are agent-session bookkeeping (repeat context-gathering handoffs on 2026-08-09, 08-10, 08-14, and 08-20) plus the initial pickup comment from the implementation session:

- `3d5878ee-9179-4cf1-bf20-a61de8f2478e` (2026-08-20T11:03, author Linear): "This thread is for an agent session with shipfox."
- `770b04b2-27b2-47f3-aa44-e96cb3ecf147` (2026-08-14T21:21, author Shipfox): context-gathering handoff; lists the graph: ENG-571 + PR #317, "Runner log capture & streaming" project, "Product spec: runner log capture & streaming" document, 13 issues (ENG-439, 440, 441, 442, 443, 444, 518, 519, 520, 531, 545, 782, 783), related logs issues (ENG-521, ENG-533, ENG-492), sibling metrics-convention issues (ENG-853, ENG-1012), "Agent sessions and per-step observability" project and its product spec, metrics conventions from `docs/architecture/observability.md`, workspace facts (`@shipfox/api-logs@13.0.0`, worktree at 540b06b). Context written to `.context/linear-issue-context.md`.
- `fdb7b848-3d8a-413e-8da9-fb22e8b65a51` (2026-08-14T20:39, Shipfox): same handoff, worktree at 540b06b.
- `405dc896-da9a-4257-b9a7-8fd6db609aea` (2026-08-10T19:25, Shipfox): same handoff, `@shipfox/api-logs@12.7.0`, clean worktree at 70aa70a.
- `301bd037-cace-4832-9353-a9361d20cacc` (2026-08-10T15:52, Shipfox): same handoff, 12.7.0, includes ENG-521 in project issues list.
- `8e34b524-bbde-482f-a4d7-133b75277878` (2026-08-10T15:43, Linear): thread marker.
- `db2df35f-7cd4-483e-930b-297896c2261b` (2026-08-10T13:30, Shipfox): same handoff, worktree at 5723d2c.
- `cd4bf2c7-4e33-46dd-a2ef-b6792160adbf` (2026-08-10T13:11, Linear): thread marker.
- `59d226fd-28de-418a-bdf4-6a0b1b2cce7b` (2026-08-10T12:07, Shipfox): same handoff, published `@shipfox/api-logs@12.5.0`.
- `502e6c1b-6398-4c4e-8986-772b9f02380a` (2026-08-10T08:45, Shipfox): same handoff.
- `14293dd5-cdba-4b3a-8d08-417ea53becfe` (2026-08-10T08:39, Linear): thread marker.
- `8decbf9c-7b40-442e-959f-2f0a1a753fad` (2026-08-09T15:32, Shipfox): same handoff.
- `360238ca-632a-4f3b-a247-d976da10ff1c` (2026-08-09T15:04, Shipfox): context gathering complete.
- `56060541-e1a0-4aa8-bd66-645eaa8be846` (2026-08-09T14:58, Linear): thread marker.
- `2623205b-dfff-4726-b2d5-69af6aecfa5f` (2026-08-09T09:39, Shipfox): implementation pickup — "Implementation targets the `@shipfox/api-logs` package: byte-volume counters (`logs_bytes_ingested`, `logs_bytes_stored`, `logs_compacted_bytes`) on the instance metric plane and a `logs_open_chunk_bytes` service gauge, with tests for appends, retries, caps, control records, and compaction. I will not commit or push; changes stay local for review."
- `6c1d0315-2280-432f-b813-6d03386992a4` (2026-08-09T09:24, Linear): thread marker.

New comment added this session: `30b76408-7c52-49e4-8399-1c0e28e84a32` (2026-08-20T11:42, Shipfox) — context-gathering pickup confirming `.context/linear-issue-context.md` is the implementation source of truth.

## 2. Team and users

### Engineering team (linear_shipfox__get_team)

```json
{"id": "d5489d68-e276-4f40-8d1a-83d511b62890", "icon": ":computer:", "name": "Engineering", "createdAt": "2024-03-13T18:34:58.317Z", "updatedAt": "2026-08-20T01:41:50.136Z"}
```

### Noé Charmet (linear_shipfox__get_user) — assignee + creator

```json
{
  "id": "be099334-9982-41b1-b336-e7b7b741d548",
  "name": "Noé Charmet",
  "email": "noe.charmet@allegoria.io",
  "displayName": "noe.charmet",
  "avatarUrl": "https://public.linear.app/be099334-9982-41b1-b336-e7b7b741d548/c269f578-39af-4991-bb44-3324ca019ef6",
  "isAdmin": true, "isGuest": false, "isActive": true,
  "createdAt": "2024-03-13T18:34:58.317Z", "updatedAt": "2026-06-25T18:34:51.227Z",
  "status": "Offline (last seen 2026-08-20T11:39:53.440Z)",
  "teams": [
    {"id": "fb9df9aa-e0eb-46ed-bab4-0fb123c95563", "name": "Glint", "key": "GLI"},
    {"id": "dc7166a0-d37f-4ae6-8c0c-c83b9ddbbaf9", "name": "Marketing", "key": "MAR"},
    {"id": "d5489d68-e276-4f40-8d1a-83d511b62890", "name": "Engineering", "key": "ENG"}
  ]
}
```

### Shipfox (delegate agent)

- id: `f35cb640-e009-40ba-9ef0-7715c70ba7a8`, name: "Shipfox". Delegate for ENG-1521; author of all agent comments.

## 3. Predecessor: ENG-571 — [metrics] Instrument @shipfox/api-logs with OpenTelemetry metrics

URL: https://linear.app/shipfox/issue/ENG-571/metrics-instrument-shipfoxapi-logs-with-opentelemetry-metrics · Status: **Done** (completed 2026-06-23) · No priority · Team Engineering · Assignee Noé Charmet.

Verbatim description:

> Add OpenTelemetry metrics to `@shipfox/api-logs`, following the pattern established in `@shipfox/api-runners`.
>
> ## References
>
> * Guidelines: `AGENTS.md` -> "Metrics & observability"
> * Worked example: `libs/api/runners/src/metrics` (instance counters + a service gauge), wired via the `ShipfoxModule.metrics` hook and `registerModuleMetrics`.
>
> ## Scope
>
> * Add a `src/metrics/` folder: `instance.ts` for counters/histograms recorded inline, and `service.ts` (only if the package owns shared state worth a gauge) registered through the module `metrics` hook.
> * Name metrics `logs_<noun>` snake_case; let the Prometheus exporter add `_total` / unit suffixes.
> * Labels must be bounded and low-cardinality. Never label with ids (streamId, jobId, etc.); per-entity detail belongs in logs and traces.
> * Record where the event is known (`core` / `db`), not in DTO mappers.
> * Add Vitest coverage for any new db query (e.g. a gauge's count function).
>
> ## Candidate metrics (suggestions, refine during implementation)
>
> * `logs_record_appended` counter (label by record kind: process / system).
> * `logs_stream_opened` / `logs_stream_closed` counters.
> * `logs_compaction` counter labeled by outcome; reuse the compaction reconcile path.
> * Service gauge `logs_open_streams` for the current count of open streams.

### ENG-571 attachments (PRs/commits)

- `[api-logs] Add OpenTelemetry metrics (#317)` — https://github.com/ShipfoxHQ/shipfox/pull/317 (subtitle null)
- `[api-logs] Add OpenTelemetry metrics (#317)` commit — https://github.com/ShipfoxHQ/shipfox/commit/03edc061deb0db460cecb08441d46ac2a7fbce87
- `Address logs metrics review feedback` — https://github.com/ShipfoxHQ/shipfox/commit/108f34048756be73b400561072478be9e7f93fe9
- `Use log record types for append metrics` — https://github.com/ShipfoxHQ/shipfox/commit/a895f33ff2afd75ad7cfc248529cfbb04f0bd774
- `Track agent session log metrics separately` — https://github.com/ShipfoxHQ/shipfox/commit/a0467d8d3460634dd54e6290fcd9c66c56674c10
- `Add logs metrics instrumentation` — https://github.com/ShipfoxHQ/shipfox/commit/dec0bc9149e31bdadd8b8c45c5517bcacbb6dcc3

State history: Backlog → In Progress (06-23T11:53) → In Review (06-23T12:04) → Done (06-23T12:29).

## 4. Project: Runner log capture & streaming

- URL: https://linear.app/shipfox/project/runner-log-capture-and-streaming-862e423503b1
- id: `863d3357-f32e-447c-ae63-4f578ea776b4` · icon :scroll: · color #bec2c8 · status **In Progress** · No priority · lead: Noé Charmet · team Engineering · member: Noé Charmet · milestones: none · resourceCount: 1.

Verbatim summary and description:

> **Summary:** Capture step logs on runners, store them durably, and stream them near-live to customer dashboards. Community edition scope.
>
> **Description:** Customers currently have no visibility into what their CI steps print: the runner buffers 1MB of output in memory and discards it. This project delivers end-to-end log capture, durable storage, and near-live dashboard streaming for the community edition.
>
> **Targets**
> * Live tail of the running step with at most a few seconds of delay (cursor polling, 1-2s).
> * At most ~5s of log loss when an ephemeral runner machine dies.
> * 90-day retention via our own deletion worker (per-customer differentiation possible later).
> * Secrets masked on the runner before bytes ever reach disk.
> * Stack stays Postgres + Temporal + any S3-compatible object storage (Garage bundled in compose; S3 API is the declared protocol).
>
> **Architecture in one paragraph**
> The runner captures merged stdout/stderr, masks secrets, converts GitHub-style `::group::` markers into control records, frames everything as versioned NDJSON records with runner-assigned timestamps, write-through spools to disk, and uploads on a min(2s, 256KB) flush. A stateless ingest module appends chunks via an offset-CAS protocol (idempotent, ordered, multi-instance safe) authenticated by the existing job lease token, enforcing an accrual budget (5MB base + 1MB/min on payload bytes, per job run, no hard ceiling). Hot chunks live in Postgres; on stream close (runner-declared end-of-stream, or lease expiry + 120s grace) a Temporal worker compacts each attempt into one gzipped NDJSON object in object storage. Reads use one cursor endpoint: inline from Postgres while the stream is open, a presigned URL (default TTL 1h) once compacted.

Resource: document "Product spec: runner log capture & streaming" (id `7d767af2-33fa-4594-8a6b-91aced40c2f6`, slugId `02c2202e84f6`) — full content in section 6.

### 4.1 Project issues (13) — linear_shipfox__list_issues(project=Runner log capture & streaming)

All by/assigned to Noé Charmet, team Engineering. Statuses as of fetch.

| Issue | Title | Status |
| -- | -- | -- |
| ENG-439 | Log ingest module foundation: schema, offset-CAS append endpoint, budget, S3 client | Done |
| ENG-440 | Runner log capture pipeline: capture, framing, disk spool, uploader with resume | Done |
| ENG-441 | Runner transform stage: streaming secret masker and GitHub-style marker detection | Done |
| ENG-442 | Stream lifecycle workers: timeout close, compaction to object storage, retention deletion | Done |
| ENG-443 | Log read path: cursor endpoint and presigned flow | Done |
| ENG-444 | Log streaming E2E coverage and self-hoster documentation | Todo |
| ENG-518 | Stream close: declared end record + job-terminated timeout, with a closed-stream guard | Done |
| ENG-519 | Compaction: move a closed stream's chunks into one gzip object in storage | Done |
| ENG-520 | Retention deletion: drop expired log objects and stream rows | Done |
| ENG-531 | Log dashboard viewer: client data layer and live tail UI | Done |
| ENG-545 | Retention: batch S3 deletes (DeleteObjects) to speed backlog drain | Canceled |
| ENG-782 | [api/logs] Slim db/index.ts barrel to its used exports (broad-barrel convention violation) | Done |
| ENG-783 | [api/logs] Retention can leak an S3 object on delete failure (row-before-object, no orphan GC) | Done |

Full details fetched for ENG-439, ENG-442, ENG-519 (see below); the others' list summaries are preserved in section 4.2.

### 4.2 Summaries of the remaining project issues (from list)

- **ENG-783** (Medium, Done): retention sweep deletes stream row first then objects by prefix — `libs/api/logs/src/core/retention.ts:86-128` `deleteExpiredStream` then `deleteObject`; an S3 delete failure leaks the object with no orphan GC. URL: https://linear.app/shipfox/issue/ENG-783/apilogs-retention-can-leak-an-s3-object-on-delete-failure-row-before
- **ENG-782** (Low, Done): `libs/api/logs/src/db/index.ts` is a broad barrel re-exporting ~15 symbols (`accrueStoredBytes`, `claimCap`, `ensureJobAccounting`, `isJobCapped`, `insertChunk`, `closeDb`, `Database`, `db`, `schema`, `Transaction`, `logsOutbox`, `CasResult`, `casExtendCommittedLength`, `getAttemptStream`, `getOrCreateAttemptStream`, `setDeclaredTotalBytes`, `migrationsPath`). URL: https://linear.app/shipfox/issue/ENG-782/apilogs-slim-dbindexts-barrel-to-its-used-exports-broad-barrel
- **ENG-520** (No priority, Done; sub-issue of ENG-442, blocked by ENG-518): retention deletion — drop expired log objects and stream rows; own worker, not bucket lifecycle; needs `closed_at` from stream-close issue. URL: https://linear.app/shipfox/issue/ENG-520/retention-deletion-drop-expired-log-objects-and-stream-rows
- **ENG-545** (Low, Canceled): batch S3 deletes via `DeleteObjects` to speed backlog drain; follow-up to ENG-520. URL: https://linear.app/shipfox/issue/ENG-545/retention-batch-s3-deletes-deleteobjects-to-speed-backlog-drain
- **ENG-531** (No priority, Done; split out of ENG-443, blocked by the read endpoint): dashboard log viewer + client data layer consuming the read path. URL: https://linear.app/shipfox/issue/ENG-531/log-dashboard-viewer-client-data-layer-and-live-tail-ui
- **ENG-443** (No priority, Done): one cursor endpoint covering live tail and history, plus presigned URLs for compacted streams; hot path depends on ENG-439, presigned branch depends on ENG-442. URL: https://linear.app/shipfox/issue/ENG-443/log-read-path-cursor-endpoint-and-presigned-flow
- **ENG-441** (No priority, Done): transform stage between capture and disk spool — streaming secret masker with rolling lookahead (literal + base64 + URL + hex forms), GitHub-style marker detection; masking must run before any byte reaches disk. URL: https://linear.app/shipfox/issue/ENG-441/runner-transform-stage-streaming-secret-masker-and-github-style-marker
- **ENG-440** (No priority, Done): merged stdout/stderr capture per step attempt, NDJSON v1 framing (runner-assigned epoch-ms timestamps, 16KB payload cap, long lines split), per-attempt disk spool, uploader with resume + end-of-stream + report integration; flush min(2s, 256KB). URL: https://linear.app/shipfox/issue/ENG-440/runner-log-capture-pipeline-capture-framing-disk-spool-uploader-with
- **ENG-518** (No priority, Done; sub-issue of ENG-442): stream close — declared end record (`end` control record with `total_bytes`) + job-terminated timeout; closed-stream guard; server-only tombstones (`capped`, `runner_lost`) never in runner appends; sets `LOG_STREAM_CLOSED` event + `closed_at`. URL: https://linear.app/shipfox/issue/ENG-518/stream-close-declared-end-record-job-terminated-timeout-with-a-closed
- **ENG-444** (No priority, Todo): E2E coverage (HTTP-first `/__e2e/` routes, Playwright journey: run a job, watch live tail, group folding, truncation states, download) + self-hoster documentation (Garage/CORS, config reference). URL: https://linear.app/shipfox/issue/ENG-444/log-streaming-e2e-coverage-and-self-hoster-documentation

### 4.3 ENG-439 (full) — Log ingest module foundation

URL: https://linear.app/shipfox/issue/ENG-439/log-ingest-module-foundation-schema-offset-cas-append-endpoint-budget · Done.

> New independent log module in the monolith (stateless by design, extractable later). Foundation for all other workstreams. Full context: project document "Product spec: runner log capture & streaming".
>
> **Scope**
> * Module skeleton following the ShipfoxModule conventions (own DB schema, routes, config).
> * Tables: job-run log accounting (budget, cap state), attempt stream (committed_length, open/closed state, close reason, truncated flag, object key), hot log chunks.
> * `POST .../steps/:stepId/logs?attempt=N&offset=B` append endpoint, job lease token auth, offset-CAS on `committed_length` (retries acked as applied, gaps rejected with 409 + committed offset). No step-state gate; the lease alone authorizes writes.
> * Server-side accrual budget per job run on payload bytes: base 5MB + 1MB/min, no hard ceiling, configurable. At cap: append `capped` tombstone control record, reject further output records, signal the runner via the append response.
> * S3-compatible client + config (`LOG_STORAGE_S3_*`, required at startup) with envalid `desc` for self-hosters.
> * Garage added to `compose.yml` for local dev.
>
> **Acceptance**
> * Concurrent/multi-instance appends serialize correctly through the CAS; duplicate uploads are idempotent.
> * Budget enforcement covered by tests including the cap tombstone path.
> * NDJSON v1 record contract (output + control kinds) defined in the module's dto package.

Attachments (selected): PR #196 "Add log ingest module foundation" (https://github.com/ShipfoxHQ/shipfox/pull/196); commits "Split appendLogs into readHeartbeat and storeChunk helpers" (61459a21…, d2d5c26b…, a728c2fd…), "Harden log-ingest budget, stream creation, and deployment" (76dc6135…, e1b2f4af…, a72a7fc3…), "Move log-ingest domain entities into core/entities" (3d9ef799…, ee338491…, 95b36446…), "Add log ingest module foundation" (7353d4db…, 87db3177…, c5418d7b…).

### 4.4 ENG-442 (full) — Stream lifecycle workers

URL: https://linear.app/shipfox/issue/ENG-442/stream-lifecycle-workers-timeout-close-compaction-to-object-storage · Done. Parent of ENG-518/519/520.

> Temporal workers owned by the log module that move streams from hot (Postgres) to cold (object storage) and enforce retention. Full context: project document "Product spec: runner log capture & streaming".
>
> **Scope**
> * Stream close: on the runner's end-of-stream record (declared total bytes), or lease expiry + grace period (`LOG_STREAM_CLOSE_GRACE_SECONDS`, default 120). Timeout close appends a `runner_lost` tombstone and marks the stream truncated. Compaction only ever runs on closed streams so late chunks cannot race it.
> * Compaction worker (outbox-event triggered, control plane only; log data never rides the outbox): concatenate chunks into one gzip-compressed NDJSON object per attempt at `logs/{workspace_id}/{job_run_id}/{step_id}/{attempt}`, set `Content-Type`/`Content-Encoding` at upload for browser-direct reads, record the object key on the stream row, delete the chunk rows.
> * Retention deletion worker: deletes objects and stream rows past `LOG_RETENTION_DAYS` (default 90). Our own worker, not bucket lifecycle rules, so behavior is identical across providers and per-workspace retention is possible later.
>
> **Acceptance**
> * Postgres chunk volume stays bounded by in-flight work regardless of retention.
> * Crash-safe compaction: re-running after a partial failure converges (idempotent upload + row cleanup).
> * Expired logs disappear from both storage and the read path.

Attachments: PR #244 "Close log streams on the runner's end record or job termination" (https://github.com/ShipfoxHQ/shipfox/pull/244), commit f973f14c…

### 4.5 ENG-519 (full) — Compaction

URL: https://linear.app/shipfox/issue/ENG-519/compaction-move-a-closed-streams-chunks-into-one-gzip-object-in · Done. Sub-issue of ENG-442; blocked by stream-close (needs `LOG_STREAM_CLOSED` + `closed_at`).

> **Context:** Once a stream is closed, its hot chunks must move from Postgres to object storage so Postgres stays bounded by in-flight work, not by retention. This issue compacts a closed stream into one gzip-compressed NDJSON object in S3-compatible storage (Garage in dev), records the object key on the stream row, and deletes the chunk rows — crash-safe and idempotent, with a reconciliation backstop.
>
> **Design** (key points):
> * Subscriber `on-log-stream-closed` (on `LOG_STREAM_CLOSED`) starts `compactStream` Temporal workflow, workflowId `logs-compact:{streamId}` (dedup).
> * Workflow → `compactStreamActivity`, long startToCloseTimeout, bounded generous retry (backoff, finite cap ~1h) then fail so the run closes.
> * Activity (streaming): load stream; `object_key` set → no-op. Keyset-paginate chunks by `seq` → gzip → `@aws-sdk/lib-storage` `Upload` (multipart) at `logs/{workspace_id}/{job_run_id}/{step_id}/{attempt}`, `Content-Type: application/x-ndjson`, `Content-Encoding: gzip`. Zero/one-chunk (tombstone-only) streams still produce a valid tiny object. Final tx: `UPDATE … SET object_key=… WHERE id AND state='closed'` + delete chunk rows; if 0 rows → `deleteObject(key)` to avoid orphaned object.
> * Crash safety: stable object key makes upload overwrite-idempotent; reads only happen after `object_key` set.
> * Multipart hygiene: `Upload.abort()` on cancellation; `AbortIncompleteMultipartUpload` lifecycle rule (Garage bootstrap).
> * Reconciliation backstop: `compactionReconcileCron` (`*/10 * * * *`) finds `state='closed' AND object_key IS NULL AND closed_at < now() - RECONCILE_STALE` and re-starts `compactStream`.
> * Why streaming, not buffer: no hard ceiling on the budget means a stream can reach hundreds of MB; streaming keeps memory flat.
>
> **Files (all in `libs/api/logs`):** `api/object-storage.ts` (+ `putCompactedObject()` abort-aware multipart, `deleteObject()`); `core/compaction.ts`; `core/reconcile.ts`; `db/chunks.ts` (+ `readChunksKeyset`); `db/streams.ts` (+ `setObjectKeyAndDeleteChunks` orphan-guarded, `listStaleUncompactedStreams`); `presentation/subscribers/on-log-stream-closed.ts`; `temporal/activities/{compact-stream,compaction-reconcile}.ts`; `temporal/workflows/{compact-stream,compaction-reconcile-cron}.ts`; `dev/garage/bootstrap.sh`; `index.ts` (subscriber + reconcile cron in `workers`).
>
> **Tests:** real Postgres + Garage from compose.yml; many chunks → object present, gzip + headers correct, `object_key` set, chunks deleted; crash-safety (run twice + `object_key`-preset → converges); zero/tombstone-only stream → valid tiny object; reconcile re-starts failed compaction, doesn't touch already-compacted or still-running; retention orphan (row deleted mid-upload → `deleteObject`); multipart abort on cancel.

Attachments: PR #247 "Compact closed log streams into one gzip object in storage" (https://github.com/ShipfoxHQ/shipfox/pull/247) + 11 commits (8fe10c83, fc64bd1c, f95937d6, 1e401438, c72d1371, a504629f, 4441af18, d48296c5, df7bede9, d3a065ef, 935aaeb3, c0d3d674, b375bd6b).

## 5. Related logs issues

### 5.1 ENG-521 (full) — Log streams created after the one-shot job-terminated sweep can leak open forever

URL: https://linear.app/shipfox/issue/ENG-521/log-streams-created-after-the-one-shot-job-terminated-sweep-can-leak · **Done** (2026-06-22) · Low priority · Relations: relatedTo ENG-442, ENG-518, ENG-519, ENG-520.

Key points (verbatim excerpts):

> The timeout-close path (`closeAbandonedStreamsActivity`) is a one-shot, deduped-per-job sweep: `WORKFLOWS_JOB_TERMINATED` arms one `closeAbandonedStreams` workflow per `jobId` (workflow id `logs-close:${jobId}`), it sleeps the grace period once, then `listOpenStreamsByJob(jobId)` snapshots the open streams once and force-closes them.
>
> Any stream whose first non-empty append lands AFTER that snapshot is never closed … A stream stuck `open` is invisible to compaction, reconcile, and retention: `logs_attempt_streams_retention_idx` and `logs_attempt_streams_uncompacted_idx` are both partial on `state = 'closed'`. Window is ~88 minutes (90m lease minus 120s grace).
>
> **Fix options:** 1. Gate the append path on live job state. 2. Add a periodic open-stream reaper over `logs_attempt_streams_open_by_job_idx` (chosen).
>
> **References:** `libs/api/logs/src/temporal/activities/close-abandoned-streams.ts`; `libs/api/logs/src/presentation/subscribers/on-job-terminated.ts`; `libs/api/logs/src/core/append-logs.ts`; `libs/api/logs/src/db/schema/attempt-streams.ts` (the `state='closed'`-only partial indexes).

Attachments: PR #274 "[api/logs] Reap streams left open after the one-shot terminate sweep" (https://github.com/ShipfoxHQ/shipfox/pull/274) + commits 0746fadd, 90b428be, 3a2c7d13, d7602d94, a50fc398, 8cab4e77, f2aab16e.

### 5.2 ENG-492 (full) — Create a shared @shipfox/regex package

URL: https://linear.app/shipfox/issue/ENG-492/create-a-shared-shipfoxregex-package-for-duplicated-regex-matchers · **Done** (2026-06-19) · Low · Related to ENG-440. Consolidated duplicated UUID/slug/token/sha matchers into a shared tested package (PR #242). Not directly needed for this task, but shows the log-module review culture. Attachments: PR #242 (https://github.com/ShipfoxHQ/shipfox/pull/242), ENG-440 PR #197 (https://github.com/ShipfoxHQ/platform/pull/197).

### 5.3 ENG-533 (full) — Logs contract v2: stream kinds, write-path enforcement, nested groups, agent-session capture

URL: https://linear.app/shipfox/issue/ENG-533/logs-contract-v2-stream-kinds-write-path-enforcement-nested-groups · **Done** (2026-06-20) · **High priority** · Project: Agent sessions and per-step observability.

> **What Shipped**
> * Stream kind support for `log_stream` and `agent_session`.
> * Write-path enforcement that keeps server-only tombstones out of runner appends.
> * Opaque `agent_session` capture semantics: the logs module validates only the log/session framing contract it owns and does not interpret pi session semantics.
> * Nested log group support for normal logs.
> * Kind-aware lifecycle events and logs-module documentation.
>
> **Current Interpretation:** This completed work is the substrate for the remaining tickets. It does not imply a future backend session domain, pi adapter, resume/fork layer, lineage store, or cost analytics.

Attachments: PR #256 (https://github.com/ShipfoxHQ/shipfox/pull/256) + commits fd89051f, 7a840cd2, cca1ddb2.

## 6. Project document: "Product spec: runner log capture & streaming"

- Document id: `7d767af2-33fa-4594-8a6b-91aced40c2f6` · slugId `02c2202e84f6` · URL: https://linear.app/shipfox/document/product-spec-runner-log-capture-and-streaming-02c2202e84f6
- Created 2026-06-12, updated 2026-06-20, by Noé Charmet. Status: agreed (2026-06-12); canonical copy also at `.context/log-streaming-spec.md` in the platform repo workspace (per the doc itself — verify existence locally).

Full verbatim content:

```markdown
# Product Spec: Runner Log Capture & Streaming (Community Edition)

Status: agreed (2026-06-12). Outcome of the exploration session; basis for this Linear project. Canonical copy also at `.context/log-streaming-spec.md` in the platform repo workspace.

## Update (2026-06-20): one log stream per attempt, no per-kind separation

A step attempt has exactly **one** log stream, identified by `(job, step, attempt)`. All of a step's output lives in it as NDJSON records: process stdout/stderr, the control records (group start/end, end-of-stream, cap, gap, runner-lost), and **agent-session capture**, which rides as an `agent_session` record whose payload is the raw session JSONL line, stored opaquely.

There is no separate stream and no per-producer `kind` on stream identity. A reader pulls every record for a `(step, attempt)` **without knowing any kind** and filters by record type; agent-session JSONL is reconstructed client-side by selecting the `agent_session` records and re-joining their payloads in order. The runner already funnels everything through one spool / one uploader / one offset, so a single record stream matches the producer exactly. An interim implementation put an `agent_session` `kind` on stream identity and forked the ingest, close, compaction, and read paths by kind; that separation is being removed — every path is kind-agnostic over the one record stream.

## Problem

Shipfox runners execute job steps but customers cannot see what those steps print. The runner captures stdout/stderr into a 1MB in-memory buffer and discards it; nothing reaches the dashboard. Customers debugging a failing or slow job are blind, and a runner crash loses even the local buffer.

## Goals

* Near-live tail of the running step in the dashboard, with at most a few seconds of delay.
* Full scrollback for every step and attempt of a job run, during and after execution.
* At most ~5s of log loss when a runner machine dies (runners are ephemeral).
* 90-day retention, structured so per-customer retention is possible later.
* Secrets are masked on the runner before bytes leave the machine.
* No new non-standard dependencies. Final stack: Postgres + Temporal + any S3-compatible object storage.
* Log ingestion is an independent module inside the monolith, stateless by design, extractable and horizontally scalable later.

## Non-goals (v1, community edition)

* Per-line search or indexing. The cloud edition will tee the same ingest stream into ClickHouse/Quickwit later; the ingest endpoint is the stable seam.
* Push transport (SSE/WebSocket). The cursor-polling read path is forward-compatible with SSE over LISTEN/NOTIFY.
* API-proxied reads of completed logs. Presigned URLs only; a proxy mode can be added later for installs whose object storage is not browser-reachable.
* Separate stdout/stderr views. Streams are merged; origin is preserved per record for future use.
* User-registered custom mask patterns (GitHub's `::add-mask::`). Masking covers secrets the runner itself holds.

## User experience

* The job run view shows all steps. Completed steps load their full log; the running step tails live (1-2s refresh) and keeps scrollback.
* Each log line renders with its capture timestamp (toggleable) and ANSI styling rendered in the viewer (v1 scope).
* Each completed step offers a raw "download log" action backed by a presigned URL.
* `::group::name` / `::endgroup::` lines (GitHub Actions syntax) become collapsible sections; the marker lines themselves are not displayed.
* Truncation is always visible, never silent:
  * Budget exhausted: a tombstone line "log output limit reached, further output dropped".
  * Runner lost mid-step: "log incomplete, runner stopped reporting".
  * Runner-side drop (backpressure overflow): an explicit gap marker.
* Masked secrets render as `***`.
* Logs remain viewable for the retention period (default 90 days), after which the steps show "logs expired".

## Architecture

### Runner capture pipeline

Per step attempt, in order:

    pty/pipe capture (stdout+stderr merged, ordered)
      -> streaming secret masker            (before anything touches disk)
      -> marker detection                   (::group:: etc. -> control records, line swallowed)
      -> NDJSON record framing              (runner-assigned timestamps, 16KB payload cap/record)
      -> per-attempt disk spool             (append-only file under the job workspace root)
      -> uploader                           (flush at min(2s, 256KB), plus flush on step exit)

* The masker holds a rolling lookahead of the longest registered secret and masks the literal value plus its base64 forms (all three phase alignments), URL-encoded form, and hex form. Masking precedes the spool so secrets never reach disk.
* v1 mask set: the runner's own credentials (runner token, job lease token), since no step-level secrets product exists yet. The set grows automatically as secrets are injected into step environments later; the pipeline stage is built now.
* The spool is the durability layer for everything short of machine loss: a runner process restart resumes from the last server-acknowledged offset; an API outage grows the spool (bounded by the log budget) and drains on recovery.
* The step loop is sequential, so at most one stream is actively written, with at most one previous attempt tail still draining.
* Worst-case loss on machine death: one flush interval plus one in-flight request, ~3-4s.

### Ingest module (new, independent module in the monolith)

* Endpoint: append chunk of framed records for `(job, step, attempt)` at byte `offset`, authenticated by the existing job lease token. The lease alone authorizes writes; no step-state lookup (accepting bytes for a finished step is low-risk and bounded by budget + lease TTL).
* Offset-CAS protocol: the server keeps `committed_length` per attempt stream. Append succeeds only when `offset == committed_length` (atomic extend). Retries (`offset < committed`) are acked as already applied. Gaps (`offset > committed`) are rejected with the current committed offset so the runner rewinds its spool cursor. This yields idempotency, strict ordering, and multi-instance safety with no coordination beyond Postgres.
* Budget enforcement (server-side; the runner also self-limits but is untrusted): accrual budget per job run over payload bytes (not envelope bytes), `allowed = base + rate * elapsed`, defaults 5MB + 1MB/min, no hard ceiling (job duration limits bound it). A job retry is a new job run with a fresh budget. At cap: server appends a cap tombstone control record, rejects further output records, and signals the runner to stop uploading.
* Stream close: on receipt of the runner's end-of-stream record (carrying declared total payload bytes), or on lease expiry + grace period (default 120s, configurable). Timeout-close appends a "runner lost" tombstone and marks the stream truncated. Compaction only runs on closed streams, so late chunks cannot race it.

### Storage

* Hot: append-only chunk table in Postgres, owned by the log module, holding only open streams plus a short tail. Bounded by in-flight work, independent of retention.
* Cold: on stream close, a Temporal worker (triggered via outbox event, control plane only) concatenates chunks into one gzip-compressed NDJSON object per attempt, sets `Content-Type`/`Content-Encoding` at upload, writes the object key to the attempt stream row, and deletes the chunk rows.
* Object layout: `logs/{workspace_id}/{job_run_id}/{step_id}/{attempt}` so retention sweeps and workspace deletion are prefix operations.
* S3 API is the declared protocol. Object storage is a required platform dependency. Garage ships in `compose.yml` for dev/self-host; any S3-compatible endpoint works in production (R2, B2, AWS S3, GCS interop, etc.).
* Retention: our own deletion worker (not bucket lifecycle rules, which vary by provider) deletes objects and stream rows past retention. Default 90 days; per-workspace override is a later extension the model already supports.

### Read path

One cursor endpoint per attempt stream, session-authenticated and workspace-scoped:

* Open stream (or closed but not yet compacted): returns framed records inline from Postgres from `offset`, plus next offset and stream state. The dashboard tails by polling this at 1-2s for the running step.
* Compacted stream: returns a presigned GET URL (TTL configurable, default 1h) plus stream metadata; the browser fetches the object directly. Egress bypasses the API entirely.
* The client hook handles both shapes behind one interface. Live tail always flows through the API (hot data lives in Postgres); presigned applies to completed attempts only.
* The endpoint is kind-agnostic: it returns every record for the `(step, attempt)`, of every type, and the caller never passes a kind. The client filters by record type for display and reconstructs agent-session JSONL by re-joining the `agent_session` record payloads in order.

### Step report integration

The existing step report gains the declared total payload bytes for the attempt's log stream. The server marks the stream complete when `committed_length` catches up, without the report ever blocking on log drain. The legacy 1MB `output` blob in the report shrinks to small structured output only.

## Contracts

### Record format: NDJSON, versioned, one JSON object per line

Output record:

    {"v":1,"ts":1765531200123,"src":"stdout","type":"output","data":"installing dependencies... done\n"}

Control records (`src` is `"system"` unless runner-originated):

    {"v":1,"ts":1765531200123,"type":"control","kind":"group_start","name":"Install deps"}
    {"v":1,"ts":1765531200123,"type":"control","kind":"group_end"}
    {"v":1,"ts":1765531200123,"type":"control","kind":"end","total_bytes":1048576}
    {"v":1,"ts":1765531200123,"type":"control","kind":"capped"}
    {"v":1,"ts":1765531200123,"type":"control","kind":"gap","dropped_bytes":4096}
    {"v":1,"ts":1765531200123,"type":"control","kind":"runner_lost"}

* `ts` is epoch milliseconds, assigned by the runner at capture (the server records ingest time per chunk for skew diagnostics only).
* `data` payload is UTF-8 with invalid sequences replaced, ANSI preserved, secrets pre-masked, max 16KB per record (longer lines split).
* `v` is the format version; future fields are additive.
* Budget accounting counts `data` payload bytes only.

(Implementation note: control records are framed flat by `type` — `{type:'group_start'}`, `{type:'capped'}`, etc. — rather than `{type:'control',kind:...}`; the `kind` shown above is the original record-subtype field and is unrelated to the per-producer stream `kind` removed in the 2026-06-20 update. An `agent_session` record carries the raw session JSONL line as an opaque `data` string and shares this same envelope.)

### Endpoints (shapes, not final paths)

* `POST .../steps/:stepId/logs?attempt=N&offset=B` (lease auth). Body: NDJSON bytes. Response: `{committed_length, capped}`. Offset mismatch: 409 with `{committed_length}`.
* `GET .../steps/:stepId/attempts/:n/logs?offset=B` (session auth). Open: NDJSON body + next-offset/state metadata. Compacted: `{url, expires_at, total_bytes, truncated}`.

## Data model (log module owns all three)

| Table | Purpose | Key fields |
| -- | -- | -- |
| job run log accounting | budget + cap state per job run | job_run_id, payload_bytes_used, capped_at |
| attempt stream | stream identity and lifecycle | step_id, attempt, committed_length, state (open/closed), close_reason (declared/timeout), declared_total_bytes, truncated, object_key, timestamps |
| log chunks (hot) | open-stream bytes pending compaction | stream_id, start_offset, byte_len, data |

## Configuration

API side (`createConfig`, all with `desc` for self-hosters):

| Variable | Default | Purpose |
| -- | -- | -- |
| `LOG_STORAGE_S3_ENDPOINT` / `_REGION` / `_BUCKET` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` / `_FORCE_PATH_STYLE` | required | S3-compatible object storage |
| `LOG_READ_URL_TTL_SECONDS` | `3600` | Presigned GET URL lifetime |
| `LOG_STREAM_CLOSE_GRACE_SECONDS` | `120` | Wait after lease expiry before timeout-closing a stream |
| `LOG_BUDGET_BASE_BYTES` | `5242880` | Accrual budget base (5MB) |
| `LOG_BUDGET_RATE_BYTES_PER_MINUTE` | `1048576` | Accrual budget rate (1MB/min) |
| `LOG_RETENTION_DAYS` | `90` | Deletion worker horizon |

Runner side:

| Variable | Default | Purpose |
| -- | -- | -- |
| `SHIPFOX_LOG_FLUSH_INTERVAL_MS` | `2000` | Max time between uploads (bounds machine-loss window) |
| `SHIPFOX_LOG_FLUSH_BYTES` | `262144` | Size threshold triggering an early flush |

## Guarantees and failure modes

| Scenario | Behavior |
| -- | -- |
| Step process crashes, runner alive | Remaining buffer flushed with the step report; no loss |
| Runner process crashes, host alive | Spool resumes from acked offset on restart; no loss |
| Runner machine dies | Lose at most ~flush interval + in-flight request (~3-4s); stream timeout-closes with "runner lost" tombstone |
| API outage | Spool grows (bounded by budget), drains on recovery; loss only if the machine also dies during the outage |
| Duplicate/retried uploads | Offset-CAS dedupes; acked as already applied |
| Budget exhausted | Cap tombstone, new output dropped server-side, runner stops uploading; job keeps running |
| Logs past retention | Deleted by worker; UI shows "logs expired" |

## Security

* Writes: job lease token only, per the existing capability model (single job, short TTL, runner untrusted). No new claims added to the lease.
* Reads: user session token, workspace-scoped. Presigned URLs are short-lived bearer capabilities; TTL configurable.
* Secrets are masked runner-side before the spool; unmasked secrets never reach disk, the API, or storage.
* Raw tokens never appear in records, object keys, or logs (existing no-token-logging rule applies).

## Self-hosting requirements (docs deliverable)

* An S3-compatible object store is required; startup fails without it. Garage is the documented and compose-bundled default.
* Presigned-only reads mean the object store must be reachable from users' browsers, with CORS configured on the bucket (documented for Garage). Installs that cannot expose storage will need the future proxy read mode; out of scope for v1.

## Workstreams

1. Ingest module foundation: module skeleton, schema, offset-CAS append endpoint, budget enforcement, S3 client + config, Garage in compose.
2. Runner capture pipeline: merged capture, framing, spool + uploader with resume, end-of-stream + report integration.
3. Transform stage: streaming secret masker (incl. encodings), GitHub-style marker detection.
4. Stream lifecycle workers: close-on-timeout, compaction to object storage, retention deletion worker.
5. Read path + dashboard: cursor endpoint, presigned flow, log viewer (tail, ANSI, timestamps, group folding, truncation states).
6. E2E + self-hoster docs: HTTP-first E2E setup routes, Garage/CORS documentation, config reference.

## Decisions log

| Decision | Rationale |
| -- | -- |
| Cursor polling, no push transport in v1 | Few-seconds latency target met by 1-2s polling; zero infra; SSE-compatible later |
| Per-step-attempt streams, not per-job | Aligns with UI, restarts, compaction, and cursor units; parallel-step-proof |
| NDJSON records over binary framing | Debuggable, browser-parseable, compresses to near-binary sizes at our caps; versioned |
| Offset-CAS append | Idempotency + ordering + multi-instance statelessness from one mechanism |
| Trust lease for writes, no step-state gate | Low risk, bounded by budget and lease TTL; stream close handles lifecycle instead |
| Budget on payload bytes | Customer quota independent of our encoding choices |
| Object storage required; S3 API as protocol; Garage default | MinIO discontinued; S3 API is the standard; Garage is self-host-oriented |
| gzip (not zstd) for compacted objects | Browser-direct presigned reads; Safari lacks zstd Content-Encoding |
| Presigned-only cold reads | Nearly all users have external object storage; cuts API egress; proxy mode deferred |
| Markers as in-stream control records | Ordering is the point; sidecar ranges create dual truth; GitHub syntax for familiarity |
| Mask before spool | The spool is plaintext on disk; secrets must never reach it |
| Retention via own deletion worker | Consistent across providers; enables per-customer retention later |
| No hard ceiling on the accrual budget | Job duration limits bound total volume; revisit if abused |
| v1 mask set = runner credentials only | No step-secrets product yet; pipeline stage built now so the set grows with it |
| Raw "download log" action in viewer | Nearly free via presigned URLs |
| ANSI rendering in viewer v1 | Preserved escape bytes are unreadable otherwise |
| One stream per attempt; agent output as a record type, not a separate `kind` (2026-06-20) | A step's output has one home and one offset axis (the runner already spools everything through a single funnel); readers pull by `(step, attempt)` and filter by record type, so no read ever needs a kind; agent-session JSONL is reconstructed from its `agent_session` records. Supersedes the interim `agent_session`-as-stream-`kind` implementation |
```

## 7. Project: Agent sessions and per-step observability

- URL: https://linear.app/shipfox/project/agent-sessions-and-per-step-observability-3c39beea3302
- id: `fcb7f08b-382d-4718-8973-7d83839a9f14` · icon :card_index_dividers: · status **Completed** (2026-07-05) · lead: Noé Charmet · team Engineering · member: Noé Charmet · milestones: none.

Verbatim summary/description (abridged to key structure):

> Agent steps currently leave too little durable context for debugging. … This project makes step execution observable without creating a separate backend agent-session domain. Agent session data is treated as log data: the runner forwards every session entry into the logs pipeline with the appropriate log type, and the backend stores and serves those entries opaquely from the logs module. Clients parse the returned entries and decide how to render them.
>
> **Full product spec:** Agent sessions and per-step observability - product spec (project document).
> **Architecture:** Logs module only; opaque session logs; runner forwarding; client rendering; per-step diffs; workflow context.
> **In Scope:** Forward agent session entries; store/read opaque session entries; capture/read per-step git diffs; client-side run view; preserve workspace-scoped access control/retention/read behavior.
> **Out of Scope:** runner-side parsing, backend session projection, resume/fork/restore, separate lineage, token/cost analytics, real-time push, restore-grade materialization, eval/replay.

Resource: document "Agent sessions and per-step observability - product spec" (id `e83867df-e395-4d72-83ba-e0c9f74129e7`, slugId `cef412df2c26`) — full content in section 8.

### 7.1 Project issues (linear_shipfox__list_issues, 14 results)

| Issue | Title | Status |
| -- | -- | -- |
| ENG-497 | Runner: forward agent session entries into logs | Done |
| ENG-493 | Logs: per-step diff artifact upload | Canceled |
| ENG-494 | Logs: read API and access control for step observability | Canceled |
| ENG-498 | Runner: capture the per-step git diff | Canceled |
| ENG-502 | Client: parse session logs and render the step timeline | Done |
| ENG-533 | Logs contract v2: stream kinds, write-path enforcement, nested groups, agent-session capture | Done (High) |
| ENG-496 | pi adapter: restore helpers | Duplicate (canceled; merged into ENG-495 then rescoped out) |
| ENG-505 | Canceled: spend dashboard | Canceled |
| ENG-504 | Canceled: analytics rollups and API | Canceled |
| ENG-503 | Canceled: cost/lineage viewer enrichments | Canceled |
| ENG-501 | Canceled: fork session across jobs | Canceled |
| ENG-500 | Canceled: resume/continue session | Canceled |
| ENG-499 | Canceled: backend agent-session domain | Canceled |
| ENG-495 | Canceled: backend pi session adapter/projection | Canceled |

Notable: ENG-497 (Done 2026-06-23) — runner forwards agent session entries into logs as `agent_session` records. ENG-502 (Done 2026-06-28) — client parses session logs. All canceled issues were rescoped; no new backend domain.

## 8. Project document: "Agent sessions and per-step observability - product spec"

- Document id: `e83867df-e395-4d72-83ba-e0c9f74129e7` · slugId `cef412df2c26` · URL: https://linear.app/shipfox/document/agent-sessions-and-per-step-observability-product-spec-cef412df2c26
- Status: draft · Owner: Noe Charmet · Created 2026-06-18, updated 2026-06-21.

Full verbatim content:

```markdown
Status: draft
Owner: Noe Charmet

A product spec from which the project's issues derive. It states the intended product and system shape for this project.

## Problem

Agent steps currently do not leave a useful enough durable trail. When an agent step fails, the user needs to inspect what happened. When a step is still running, the user needs to follow progress. After a step finishes, the user needs to see the session activity and the diff the step produced.

The important correction for this version of the project: an agent session is not a backend domain object. For now it is a stream of log entries. The runner forwards entries, the logs module stores and serves them, and the client parses them for display.

## Goals and outcomes

* Agent session entries are captured as logs and can be read while the step is running or after it finishes.
* The backend treats session entries as opaque log data. It does not parse pi sessions, run SDK-specific adapters, compute a transcript, or store a separate session record.
* The runner does not parse the session into a richer model. It forwards every session entry it receives with the appropriate log type.
* Every mutating step can leave a best-effort git diff artifact showing what changed on disk.
* The client can render a useful run view by parsing log entries client-side: messages, tool calls, thinking, failures, running state, and the step diff.
* API-side work stays inside the logs module.

## Non-goals

* Resume, fork, or restore behavior.
* Backend session projection, SDK-specific session adapters, or a dedicated agent-session module.
* Separate lineage storage. Any lineage-like UI should use workflow/job/step data that already exists.
* Token/cost analysis, spend rollups, spend APIs, or dashboards.
* Runner-side parsing of pi session internals.
* Real-time push or websocket updates. Live viewing can poll logs.
* Restore-grade working-tree materialization.
* Eval/replay.
* In-line secret scrubbing of artifact bytes beyond existing logs behavior.

## Users and key flows

* **Engineer debugging a step:** opens the run, sees the session log timeline and the diff the step produced, and can jump to the relevant failure state in the client UI.
* **Engineer watching a long run:** opens an in-progress agent step and sees newly committed session log entries appear through polling.
* **Workflow author reviewing output:** compares step-level logs and diffs to understand what each step contributed.

## Architecture

The project extends the logs module rather than adding a new agent-session layer.

**Logs module.** `@shipfox/api-logs` owns API-side ingest, storage, retention, access control, and read APIs for step observability data. It stores:

* **log stream** - normal stdout/stderr/control logs.
* **agent session entries** - opaque log entries forwarded by the runner. The backend validates only the log contract it owns and does not interpret the session as pi-specific data.
* **per-step diff** - a whole-artifact upload for the net diff a step produced.

**Runner capture.** The runner forwards session entries into the log pipeline with the appropriate type field. It should preserve ordering and avoid partial-entry writes, but it should not parse pi session semantics or build a backend transcript. Per-step diff capture runs at step completion and is best-effort.

**Read model.** The backend read API returns log entries and diff artifacts. It does not return a backend-projected session view. The client owns parsing and presentation of session entries.

**Client rendering.** The client converts returned session log entries into UI: messages, tool calls, thinking, lifecycle markers, running/partial states, failure navigation, and diff display. This parsing is a client-side responsibility so the backend can remain format-agnostic for now.

**Workflow context.** Relationships such as continued-from, forked-from, or neighboring steps are not modeled as agent-session lineage in this project. If the UI needs navigation between related work, it uses workflow/job/step data.

## Data handling, security, and retention

* Session logs and diffs can contain source code, prompts, and tool input/output.
* Access is workspace-scoped; cross-workspace reads must be refused.
* Existing logs retention and workspace deletion behavior apply.
* The backend must not log raw session payloads while handling ingest or read errors.
* In-line secret scrubbing is not expanded by this project.

## Delivery

The useful delivery units are:

* **Logs read/write surface** - store and serve opaque session logs and diff artifacts from `@shipfox/api-logs`.
* **Runner forwarding** - forward agent session entries into the logs pipeline without parsing them.
* **Runner diff capture** - upload a best-effort git diff for mutating steps.
* **Client viewer** - parse session log entries client-side and render a readable run timeline plus diff.

Dropped from this project: pi adapter/projection, backend session records, resume/fork, separate lineage, token/cost analytics, and spend dashboards.

## Open questions

* Exact shape of the client-side parser contract for session log entry types.
* Diff size budget and truncation behavior.
* Whether diff capture is enabled for all mutating steps immediately or agent steps first.
* Polling cadence and pagination behavior for large sessions.
* How much failure navigation can be derived from the current log entry types without adding backend semantics.
```

## 9. Sibling metrics-convention issues

### 9.1 ENG-853 (full) — Add tool-call audit logging and metrics

URL: https://linear.app/shipfox/issue/ENG-853/add-tool-call-audit-logging-and-metrics · **Done** (2026-07-08) · High · Project: Integration Agent Tools (GitHub first) · Blocked by ENG-847 (MCP tool gateway).

> Add structured audit logging and metrics for integration tool calls.
>
> Audit logs should include job, execution, workspace, connection, provider, tool id, method when present, argument summary, and outcome. High-cardinality identifiers belong in logs/traces, not metrics.
>
> Instance counters should use bounded labels only. Use `provider`, `tool`, `method`, and `outcome`; `method` is bounded by the catalog and should use a sentinel value such as `none` for standalone tools. Do not label metrics with connection id, job id, workspace id, repository, raw URL, or error text.
>
> Packages: `libs/api/integration/core`, `libs/api/integration/github`. Spec: section 12 plus Appendix A catalog amendment.

Attachments: PR #710 (https://github.com/ShipfoxHQ/shipfox/pull/710), commit a5afd6ba.

### 9.2 ENG-1012 (full) — EC2 provisioner: observability (metrics and logs)

URL: https://linear.app/shipfox/issue/ENG-1012/ec2-provisioner-observability-metrics-and-logs · **Done** (2026-07-21) · Medium · Project: EC2 Runner Provisioner · Blocks ENG-1014, blocked by ENG-1010.

> Part of the EC2 Runner Provisioner (see the project document). Follow the metrics conventions (per-package `src/metrics`, instance plane vs service plane, module-prefixed snake_case names, bounded low-cardinality labels only).
>
> ## Scope
> * `ec2_provisioner_launch` counter labeled by `market` (spot | on-demand) and `outcome` (launched | capacity | throttled | error).
> * `ec2_provisioner_terminate` counter labeled by `reason` (backend-terminate | registration-deadline | spot-interruption | observed-terminated).
> * `ec2_provisioner_reconcile_absent` counter (divergence signal).
> * `ec2_provisioner_managed_instances` service gauge by state.
> * Structured logs carry per-runner detail (provisioned_runner_id, AWS instance id); never in metric labels.
> * Cardinality review: no instance id, reservation id, or unbounded value in any label.
>
> ## Acceptance
> * Metrics recorded at the launch / terminate / reconcile event sites in the lifecycle.
> * Cardinality review passes; the package builds and unit tests import cleanly (no metrics port bound at import time).

Attachments: PR #893 (https://github.com/ShipfoxHQ/shipfox/pull/893), commit 24c1c130.

## 10. Metrics conventions (local repo, docs/architecture/observability.md)

Read from `docs/architecture/observability.md` in the workspace (this is the canonical guidance the issue's metrics must follow). Key rules:

- **Metric planes:** instance metrics (events; counters/histograms recorded inline; port 9464; Prometheus sums them) vs service metrics (point-in-time value from shared storage, e.g. queue depth; observable gauges on port 9474; not summed across pods).
- **Instrument creation:** instance instruments created at module load in `src/metrics/instance.ts`; recorded where the event is known most precisely (`core`/`db`, not DTO mappers). `instanceMetrics` is a no-op before instrumentation; no proxy meter — an instrument created before startup stays a no-op forever. Preload instance instrumentation before the app module graph loads.
- **Service gauges:** must not bind a port during module import; create meter and callbacks inside `register<Module>ServiceMetrics()` in `src/metrics/service.ts`; register on the module `metrics` hook (`ShipfoxModule.metrics`).
- **Layout:** `src/metrics/instance.ts`, `src/metrics/service.ts`, `src/metrics/index.ts` re-exports.
- **Naming:** snake_case prefixed with the module (`logs_...`); do not append `_total` to a counter; do not append a unit suffix to a histogram name (exporter derives suffixes); set `unit` where it helps.
- **Labels:** bounded, low-cardinality (outcome, reason, type, conclusion, provider, OS). Never identifiers (job, run, workspace, organization, user, request, stream IDs), raw URLs, or error messages. Type the allowed label shape at instrument definition.
- **Metrics may be recorded in `core` or `db`, not in pure row mappers/DTO converters.** Service-gauge callbacks use normal package database functions, not raw db access.

### OpenTelemetry package (`@shipfox/node-opentelemetry`)

- `instanceMetrics` re-exports the OpenTelemetry `metrics` API — `instanceMetrics.getMeter('logs')` for instance instruments.
- `getServiceMetricsProvider()` returns the app metrics provider for service gauges.
- Instance metrics port 9464 (`/metrics`), service metrics port 9474 (`/metrics`); `OTEL_SDK_DISABLED` disables.
- No existing byte-unit (`By`) usage found in any `src/metrics/instance.ts` in the repo (searched `unit:` across packages: only `ms` and `1` are used today). "Use OpenTelemetry byte units" therefore means the UCUM unit `'By'` on the new instruments — nothing else in the repo uses it yet, so this is the first byte-unit instrument set.
- Worked example packages: `libs/api/runners/src/metrics` (instance counters + service gauge), `libs/api/logs/src/metrics` (current), `libs/provisioner-ec2` / `libs/api/dispatcher` / `libs/api/secrets` / `libs/api/triggers` / `libs/api/workflows` / `libs/api/integration`.

## 11. Local workspace facts (implementation-relevant)

- Package: `@shipfox/api-logs` at **13.0.0** (libs/api/logs/package.json; private: false; ESM; `imports` map `#test/*` → `./test/*`, `#*` → `./src/*` workspace-source / `./dist/*` default).
- Git: branch `master`-based worktree at HEAD `7f3169a` ("Handle maximal root partitions during bootstrap (#1387)"). Working tree is clean except the untracked `.context/` directory.
- `libs/api/logs/src/` layout: `api/`, `config.ts` (+ `config.test.ts`), `core/`, `db/`, `index.ts`, `metrics/`, `presentation/`, `temporal/`.

### Current instruments — `src/metrics/instance.ts` (verbatim)

```ts
import type {LogRecord} from '@shipfox/api-logs-dto';
import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('logs');

export type LogRecordMetricKind = LogRecord['type'];

export const recordAppendedCount = meter.createCounter<{kind: LogRecordMetricKind}>(
  'logs_record_appended',
  {description: 'Log records appended to durable stream storage by record type'},
);

export const streamOpenedCount = meter.createCounter<Record<string, never>>('logs_stream_opened', {
  description: 'Log streams opened by first append',
});

export const streamClosedCount = meter.createCounter<{reason: 'declared' | 'timeout'}>(
  'logs_stream_closed',
  {description: 'Log streams closed by reason'},
);

export type CompactionMetricOutcome =
  | 'already-compacted'
  | 'compacted'
  | 'failed'
  | 'gone'
  | 'retention-raced'
  | 'superseded';

export const compactionCount = meter.createCounter<{outcome: CompactionMetricOutcome}>(
  'logs_compaction',
  {description: 'Log stream compaction attempts by outcome'},
);
```

### Current service gauge — `src/metrics/service.ts` (verbatim)

```ts
import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {getOpenStreamCount} from '#db/streams.js';

export function registerLogsServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('logs');

  const openStreams = meter.createObservableGauge('logs_open_streams', {
    description: 'Log streams currently open for appends',
  });

  meter.addBatchObservableCallback(
    async (observer) => {
      observer.observe(openStreams, toSafeGaugeNumber(await getOpenStreamCount()));
    },
    [openStreams],
  );
}

function toSafeGaugeNumber(value: bigint): number {
  // OpenTelemetry gauges accept numbers; clamp unrepresentable DB counts rather than round them.
  if (value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return Number.MAX_SAFE_INTEGER;
}
```

`src/metrics/index.ts`: `export {registerLogsServiceMetrics} from './service.js';` (only the service registration is exported).

### `core/append-logs.ts` (the `:187` reference)

- Line ~187-196: `storeChunk(tx, {params, streamId, body, committedLength, declaredTotalBytes})` — the function the issue's `append-logs.ts`:187 reference points at (JSDoc "Accrues the stored bytes, persists the chunk, and trips the per-job cap…" sits just above it; the `storeChunk` signature lands at line ~191 in the current file).
- Key semantics for byte accounting:
  - `parseAppendBody(body)` — pure pre-transaction parse; requires whole newline-terminated lines; `committed_length` always lands on line boundaries; rejects malformed bodies; enforces `LOG_MAX_SESSION_LINE_BYTES` for `agent_session` lines; extracts `declaredTotalBytes` from an `end` record.
  - `readHeartbeat(tx, params)` — empty-body heartbeat returns committed length without materializing a stream (no bytes counted).
  - `storeChunk` — `accrueStoredBytes(tx, {jobId, delta: storedByteLen})` charges the **normalized stored body** (`stored.body` from `buildStoredBody`, i.e. after agent-session parsing/normalization — `body.length` of the *stored* buffer, not the raw append body); already-capped → accept-and-drop (`stored: false`, `recordCounts: {}`, nothing stored, `committed_length` still advanced); else `insertChunk` + optional `setDeclaredTotalBytes`; over-budget → `claimCap` (single winner) + in-band `capped` tombstone chunk (origin `'control'`).
  - `appendLogs` — offset-CAS: `getOrCreateAttemptStreamWithStatus` (created → `metrics.streamOpened`), `casExtendCommittedLength` outcomes: `gap` → `OffsetGapError(cas.committedLength)`; `retry` → acked-as-applied return (no metrics recorded, no bytes stored — **retries must not double-count**); closed stream → accept-and-drop (no metrics).
  - `buildStoredBody` — agent-session records are parsed into stored session rows (claude harness), so stored bytes ≠ raw bytes; `recordCounts` per stored record type.
  - Metrics recorded after the transaction: `streamOpenedCount.add(1)` when created, `recordAppendedCount.add(count, {kind})` per kind from `metrics.recordCounts`, `streamClosedCount.add(1, {reason: 'declared'})` when declared-close succeeded. **No byte metrics exist yet** — this is where `logs_bytes_ingested` (raw runner bytes accepted after offset validation) and `logs_bytes_stored` (normalized durable bytes written to chunks) belong. Raw accepted bytes = `commitByteLen` (params.body.length) on successful CAS (not on gap/retry/closed/heartbeat); normalized stored bytes = bytes actually inserted via `insertChunk` (stored.body.length, and the `capped` tombstone chunk for the winner).
- Test file: `libs/api/logs/src/core/append-logs.test.ts` exists (patterns for append/retry/cap/control-record tests).

### `compact-stream.ts`:38 and `core/compaction.ts`

- `libs/api/logs/src/core/compaction.ts` — `compactedGzipStream(params: CompactedGzipStreamParams)` at line **38**: builds a gzip stream of a closed stream's chunk bytes in `seq` order via `readChunksKeyset` keyset pagination (`CHUNK_PAGE_SIZE = 64`); fills `CompactionStreamStats {chunkCount, lastSeq, uncompressedBytes}` as bytes flow; `onPage` hook for heartbeats. The `uncompressedBytes` stat is the natural source for a `logs_compacted_bytes` counter.
- `libs/api/logs/src/temporal/activities/compact-stream.ts` — `compactStreamActivity` (wraps `compactStream`; final outcome recorded via `compactionCount.add(1, {outcome})` in a `finally`). Outcomes: `'gone' | 'already-compacted' | 'superseded' | 'retention-raced' | 'compacted'` (+ `'failed'` on throw). Success returns `{outcome: 'compacted', objectKey, chunkCount, uncompressedBytes}`. Byte counting must happen only for the `'compacted'` outcome (or per-outcome semantics per the issue's "bytes successfully compacted"), and idempotent re-runs (`already-compacted`) must not double-count.
- `libs/api/logs/src/temporal/activities/compact-stream.test.ts` exists.
- Compaction is also driven by `compaction-reconcile` activity/cron (`temporal/activities/compaction-reconcile.ts`, `temporal/workflows/compaction-reconcile-cron.ts`).

### DTO record types (`@shipfox/api-logs-dto`, `src/schemas/record.ts`)

Discriminated by flat `type`: raw-write union includes `output`, `group_start`, `group_end`, `end`, `gap`, `agent_session`; server-only (read-union) tombstones `capped`, `runner_lost` are rejected on the raw append path (forged-type detection in `detectForgedType`). Record envelope `{v, ts, ...}`; `LogRecord['type']` is the `LogRecordMetricKind` label set used by `logs_record_appended`.

### DB layer (relevant queries)

- `#db/streams.ts`: `getOpenStreamCount()` (used by the existing gauge — returns bigint), `getOrCreateAttemptStreamWithStatus`, `casExtendCommittedLength`, `getAttemptStreamById`, `setObjectKeyAndDeleteChunks`, `setDeclaredTotalBytes`.
- `#db/chunks.ts`: `insertChunk`, `readChunksKeyset`, `chunkStats` (`{count, maxSeq, uncompressedBytes}` used by compaction integrity check).
- `#db/accounting.ts`: `ensureJobAccounting`, `accrueStoredBytes` (returns `null`/falsy when already capped; else `{used, startedAt}`), `claimCap`, `isJobCapped`.
- `#db/schema/attempt-streams.ts`: partial indexes `logs_attempt_streams_retention_idx` and `logs_attempt_streams_uncompacted_idx` on `state = 'closed'`.
- For `logs_open_chunk_bytes` (service gauge): a query summing `byte_len` over hot chunk rows (e.g. `SELECT COALESCE(SUM(byte_len), 0) FROM log_chunks`) is the expected shape, mirroring `getOpenStreamCount`; follow the ENG-571 convention "Add Vitest coverage for any new db query".

### Module registration

`libs/api/logs/src/index.ts` → `createLogsModule({workflows, jobLeaseTokenTtlSeconds})` returns `ShipfoxModule` with `metrics: registerLogsServiceMetrics`, `database: {db, migrationsPath, databaseNamespace: 'logs'}`, routes, publishers (`logs` outbox), subscribers (`WORKFLOWS_STEP_ATTEMPT_TERMINATED`, `WORKFLOWS_JOB_TERMINATED`, `LOG_STREAM_CLOSED`), workers (lifecycle + compaction task queues).

## 12. Interpretation notes for the implementation agent

- The four metrics to add: `logs_bytes_ingested` (instance counter, raw runner bytes accepted after offset validation), `logs_bytes_stored` (instance counter, normalized durable bytes written to log chunks), `logs_open_chunk_bytes` (service gauge, current bytes in un-compacted hot chunks), `logs_compacted_bytes` (instance counter, bytes successfully compacted to object storage).
- Semantics to define explicitly in code/descriptions: raw-ingested = `commitByteLen` (raw append body length) accepted through the offset CAS (exclude gaps/retries/closed-stream drops/heartbeats/capped drops); normalized-stored = bytes actually persisted in chunk rows (`insertChunk` `byteLen`), including the in-band `capped` tombstone written by the cap winner, excluding accept-and-drop.
- OTel byte unit: `unit: 'By'` on all four instruments (first use in the repo).
- Planes: three instance counters in `src/metrics/instance.ts` (created at module load; recorded in `core/append-logs.ts` and `core/compaction.ts`/`temporal/activities/compact-stream.ts`); service gauge in `src/metrics/service.ts` via `registerLogsServiceMetrics` + a DB query for hot chunk bytes (respect no-port-at-import and bigint→safe-number clamping).
- Double-counting hazards: CAS `retry` outcome returns early (acked as applied) — no byte recording; `gap` throws — no recording; closed-stream accept-and-drop — no recording; capped accept-and-drop — no `stored` bytes but raw ingestion still happened (define: ingested counts raw accepted bytes even when dropped; stored only counts what is durable); compaction `already-compacted`/`superseded`/`retention-raced`/`gone`/`failed` must not count as compacted bytes.
- Tests required: successful appends, retries, caps, control records, and compaction (existing test files: `append-logs.test.ts`, `compact-stream.test.ts`, `finalize-attempt-stream.test.ts`, `budget.test.ts`).
- No commit/push in this task per the pickup comment; changes stay local for review.
