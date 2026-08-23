# @shipfox/runner-orchestration

## 0.1.28

### Patch Changes

- Updated dependencies [0d3c2e3]
  - @shipfox/api-workflows-dto@13.1.0
  - @shipfox/runner-agent@0.2.13
  - @shipfox/runner-protocol@0.2.19
  - @shipfox/runner-execution@0.1.26
  - @shipfox/runner-workspace@0.0.21
  - @shipfox/runner-logs@0.1.25

## 0.1.27

### Patch Changes

- Updated dependencies [af6b31e]
  - @shipfox/api-workflows-dto@13.0.0
  - @shipfox/runner-agent@0.2.12
  - @shipfox/runner-protocol@0.2.18
  - @shipfox/runner-execution@0.1.25
  - @shipfox/runner-workspace@0.0.20
  - @shipfox/runner-logs@0.1.24

## 0.1.26

### Patch Changes

- 7f186cf: Forward the ambient Git config a persisted checkout writes to shell run steps. A later `run` step then commits and pushes with the checkout author identity and repository-scoped credential.
- Updated dependencies [7f186cf]
  - @shipfox/runner-execution@0.1.24
  - @shipfox/runner-agent@0.2.11

## 0.1.25

### Patch Changes

- Updated dependencies [4df5e37]
  - @shipfox/api-workflows-dto@12.7.0
  - @shipfox/runner-agent@0.2.10
  - @shipfox/runner-execution@0.1.23
  - @shipfox/runner-protocol@0.2.17
  - @shipfox/runner-workspace@0.0.19
  - @shipfox/runner-logs@0.1.23

## 0.1.24

### Patch Changes

- Updated dependencies [53b87f0]
  - @shipfox/api-workflows-dto@12.6.0
  - @shipfox/runner-agent@0.2.9
  - @shipfox/runner-execution@0.1.22
  - @shipfox/runner-protocol@0.2.16
  - @shipfox/runner-workspace@0.0.18
  - @shipfox/runner-logs@0.1.22

## 0.1.23

### Patch Changes

- Updated dependencies [5b1838c]
  - @shipfox/api-workflows-dto@12.5.0
  - @shipfox/runner-agent@0.2.8
  - @shipfox/runner-execution@0.1.21
  - @shipfox/runner-protocol@0.2.15
  - @shipfox/runner-workspace@0.0.17
  - @shipfox/runner-logs@0.1.21

## 0.1.22

### Patch Changes

- @shipfox/runner-agent@0.2.7
- @shipfox/runner-protocol@0.2.14
- @shipfox/runner-execution@0.1.20
- @shipfox/runner-logs@0.1.20

## 0.1.21

### Patch Changes

- Updated dependencies [4b0731e]
  - @shipfox/api-workflows-dto@12.3.0
  - @shipfox/runner-agent@0.2.6
  - @shipfox/runner-execution@0.1.19
  - @shipfox/runner-protocol@0.2.13
  - @shipfox/runner-workspace@0.0.16
  - @shipfox/runner-logs@0.1.19

## 0.1.20

### Patch Changes

- Updated dependencies [ce0984d]
  - @shipfox/api-workflows-dto@12.2.0
  - @shipfox/runner-agent@0.2.5
  - @shipfox/runner-protocol@0.2.12
  - @shipfox/node-opentelemetry@0.6.4
  - @shipfox/runner-execution@0.1.18
  - @shipfox/runner-workspace@0.0.15
  - @shipfox/runner-logs@0.1.18

## 0.1.19

### Patch Changes

- Updated dependencies [312a137]
  - @shipfox/api-workflows-dto@12.1.0
  - @shipfox/runner-agent@0.2.4
  - @shipfox/runner-execution@0.1.17
  - @shipfox/runner-protocol@0.2.11
  - @shipfox/runner-workspace@0.0.14
  - @shipfox/runner-logs@0.1.17

## 0.1.18

### Patch Changes

- Updated dependencies [ee2ce67]
- Updated dependencies [f7939c7]
- Updated dependencies [f78740d]
- Updated dependencies [dea1ffd]
- Updated dependencies [adf07e7]
- Updated dependencies [285fff2]
- Updated dependencies [e44a279]
- Updated dependencies [54c820e]
- Updated dependencies [35a42bd]
- Updated dependencies [d77baaa]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [cb0abfa]
  - @shipfox/api-workflows-dto@12.0.0
  - @shipfox/redact@0.2.6
  - @shipfox/runner-agent@0.2.3
  - @shipfox/runner-execution@0.1.16
  - @shipfox/runner-protocol@0.2.10
  - @shipfox/runner-workspace@0.0.13
  - @shipfox/runner-logs@0.1.16
  - @shipfox/api-secrets-dto@12.0.0

## 0.1.17

### Patch Changes

- @shipfox/runner-agent@0.2.2

## 0.1.16

### Patch Changes

- 6be5a54: Make managed runner assignment polling use an explicit bounded wait and retry transport timeouts while the control session remains healthy.
- Updated dependencies [6be5a54]
  - @shipfox/runner-protocol@0.2.9
  - @shipfox/runner-agent@0.2.1
  - @shipfox/runner-logs@0.1.15
  - @shipfox/runner-execution@0.1.15

## 0.1.15

### Patch Changes

- Updated dependencies [35fb890]
  - @shipfox/runner-agent@0.2.0

## 0.1.14

### Patch Changes

- Updated dependencies [22bf8a2]
- Updated dependencies [e5f7cfe]
  - @shipfox/api-workflows-dto@10.0.0
  - @shipfox/runner-agent@0.1.14
  - @shipfox/runner-execution@0.1.14
  - @shipfox/runner-protocol@0.2.8
  - @shipfox/runner-workspace@0.0.12
  - @shipfox/api-secrets-dto@9.0.2
  - @shipfox/runner-logs@0.1.14
  - @shipfox/config@1.2.4
  - @shipfox/redact@0.2.5
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-resilient-loop@0.0.1

## 0.1.13

### Patch Changes

- Updated dependencies [4acf8bc]
- Updated dependencies [4425c6d]
- Updated dependencies [6017e56]
  - @shipfox/runner-protocol@0.2.7
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/api-workflows-dto@9.3.0
  - @shipfox/runner-agent@0.1.13
  - @shipfox/runner-execution@0.1.13
  - @shipfox/runner-logs@0.1.13
  - @shipfox/runner-workspace@0.0.11

## 0.1.12

### Patch Changes

- Updated dependencies [4b85404]
  - @shipfox/api-secrets-dto@9.0.2
  - @shipfox/api-workflows-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/redact@0.2.5
  - @shipfox/runner-execution@0.1.12
  - @shipfox/runner-protocol@0.2.6
  - @shipfox/runner-agent@0.1.12
  - @shipfox/runner-logs@0.1.12
  - @shipfox/runner-workspace@0.0.10

## 0.1.11

### Patch Changes

- Updated dependencies [8436596]
- Updated dependencies [475ce59]
  - @shipfox/api-secrets-dto@9.0.1
  - @shipfox/redact@0.2.4
  - @shipfox/api-workflows-dto@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/runner-agent@0.1.11
  - @shipfox/runner-execution@0.1.11
  - @shipfox/runner-logs@0.1.11
  - @shipfox/runner-protocol@0.2.5
  - @shipfox/runner-workspace@0.0.9
  - @shipfox/node-resilient-loop@0.0.1

## 0.1.10

### Patch Changes

- Updated dependencies [02974d6]
  - @shipfox/api-secrets-dto@9.0.0
  - @shipfox/api-workflows-dto@9.0.0
  - @shipfox/runner-agent@0.1.10
  - @shipfox/runner-execution@0.1.10
  - @shipfox/runner-logs@0.1.10
  - @shipfox/runner-protocol@0.2.4
  - @shipfox/runner-workspace@0.0.8
  - @shipfox/config@1.2.2
  - @shipfox/redact@0.2.3
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-resilient-loop@0.0.1

## 0.1.9

### Patch Changes

- @shipfox/api-workflows-dto@8.0.0
- @shipfox/runner-agent@0.1.9
- @shipfox/runner-protocol@0.2.3
- @shipfox/runner-execution@0.1.9
- @shipfox/runner-workspace@0.0.7
- @shipfox/runner-logs@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies [6ce08c0]
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/runner-agent@0.1.8
  - @shipfox/runner-execution@0.1.8
  - @shipfox/runner-logs@0.1.8
  - @shipfox/runner-protocol@0.2.2
  - @shipfox/runner-workspace@0.0.6

## 0.1.7

### Patch Changes

- @shipfox/runner-agent@0.1.7
- @shipfox/runner-protocol@0.2.1
- @shipfox/runner-execution@0.1.7
- @shipfox/runner-logs@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [ce8fb21]
  - @shipfox/runner-protocol@0.2.0
  - @shipfox/runner-agent@0.1.6
  - @shipfox/runner-execution@0.1.6
  - @shipfox/runner-logs@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [23563de]
- Updated dependencies [7ac43a4]
- Updated dependencies [a42b575]
- Updated dependencies [23a4dc2]
  - @shipfox/api-workflows-dto@6.0.0
  - @shipfox/redact@0.2.3
  - @shipfox/api-secrets-dto@6.0.0
  - @shipfox/runner-agent@0.1.5
  - @shipfox/runner-protocol@0.1.4
  - @shipfox/runner-execution@0.1.5
  - @shipfox/runner-workspace@0.0.5
  - @shipfox/runner-logs@0.1.5

## 0.1.4

### Patch Changes

- Updated dependencies [bb037af]
  - @shipfox/api-secrets-dto@5.0.0
  - @shipfox/api-workflows-dto@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/redact@0.2.2
  - @shipfox/runner-execution@0.1.4
  - @shipfox/runner-protocol@0.1.3
  - @shipfox/runner-agent@0.1.4
  - @shipfox/runner-logs@0.1.4
  - @shipfox/runner-workspace@0.0.4
  - @shipfox/node-resilient-loop@0.0.1

## 0.1.3

### Patch Changes

- Updated dependencies [7a71e7d]
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/runner-agent@0.1.3
  - @shipfox/runner-execution@0.1.3
  - @shipfox/runner-logs@0.1.3
  - @shipfox/runner-protocol@0.1.2
  - @shipfox/runner-workspace@0.0.3

## 0.1.2

### Patch Changes

- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/api-secrets-dto@2.0.0
  - @shipfox/api-workflows-dto@2.0.0
  - @shipfox/config@1.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/redact@0.2.1
  - @shipfox/runner-execution@0.1.2
  - @shipfox/runner-protocol@0.1.1
  - @shipfox/runner-agent@0.1.2
  - @shipfox/runner-logs@0.1.2
  - @shipfox/runner-workspace@0.0.2
  - @shipfox/node-resilient-loop@0.0.1

## 0.1.1

### Patch Changes

- Updated dependencies [68b8d03]
  - @shipfox/redact@0.2.0
  - @shipfox/runner-execution@0.1.1
  - @shipfox/runner-logs@0.1.1
  - @shipfox/runner-agent@0.1.1

## 0.1.0

### Minor Changes

- 03d9eae: Adds runner-advertised tool capabilities to registration, heartbeat, persistence, and runner protocol reporting.

### Patch Changes

- eb40964: Add an inline `agent` workflow step that the runner runs with the pi harness. A step is an agent step when it carries `model` + `prompt` and no `run`; it takes a free-text `model`, a single `prompt`, and an optional `thinking` level (default `high`). The step runs to process-success (the agent ran to completion) and reports through the existing step protocol with no runner/backend protocol change, so change quality is judged by a downstream `run` + `gate` step. v1 does not persist the agent's work (no diff, commit, or PR).
- 05b61f6: Adds run-step annotation summary and spool collection with leased annotation publishing.
- c17dd6e: Adds run-step output emission through `$SHIPFOX_OUTPUT` with runner-side parsing, caps, masking, and report plumbing.
- 68e4022: Collapse the log stream `kind` into one stream per `(job, step, attempt)`. `kind` was modeled at the wrong layer: the runner already funnels every record through one spool and one offset axis, so the per-kind split (separate stream rows, identity, and ingest dispatch) was unnecessary server-side modeling. A reader now pulls every record for a step attempt and filters by the record `type` at read time, without passing a kind.
  - The append request drops the `kind` query param and `LogStreamClosedEvent` drops `kind`. `streamKind`/`StreamKind` and the `agent_session` line validator (`parseSessionLine`) are removed.
  - `attempt_streams` identity becomes `(job, step, attempt)`; the `kind` and now-dead `capped` columns are dropped (budget cap is signaled in-band by a `capped` tombstone and tracked in `job_accounting`). The close path injects `capped`/`runner_lost` tombstones uniformly.
  - `LOG_MAX_SESSION_LINE_BYTES` is removed and `LOG_APPEND_BODY_LIMIT_BYTES` is right-sized to 1 MiB. The runner's flush-window comment is corrected to match (the server body limit is now 1 MiB, no longer 8 MiB).

  Agent-session capture (its own record `type`(s) and runner producer) is deferred to the agent-sessions feature, which will emit those records into this same stream.

- 6c80f00: Add the runner-side log capture pipeline: per step attempt, the runner captures merged stdout/stderr, frames it as versioned NDJSON (runner-assigned timestamps, 16KB payload cap with UTF-8-safe splitting, ANSI preserved), write-through spools it to an append-only file under the job workspace, and uploads it with an offset-CAS protocol that resumes via a zero-length probe and dedupes. Output capture moves off the legacy in-memory 1MB buffer onto an `onOutput` sink.

  This consumes the `@shipfox/api-logs-dto` contract and the server `/logs` ingest route shipped by the log ingest foundation (ENG-439). Masking lands in a follow-up issue, so this pipeline must be enabled only once that exists.

- 360d06d: Add the runner log transform stage between capture and the spool: a streaming secret masker and GitHub-style group-marker detection. Captured output is masked before any byte reaches the plaintext spool, replacing the runner's own credentials (runner token and job lease token) plus every base64, base64url, URL-encoded, and hex form with `***` through a rolling lookbehind that never emits a secret split across capture-chunk or flush boundaries, and `::group::`/`::endgroup::` lines become `group_start`/`group_end` control records with the marker line swallowed. Output streams continuously (complete lines flush immediately, unterminated lines stream their masked safe prefix) so live tail, stream order, and frame timestamps are preserved. `@shipfox/redact` gains `secretWireForms` to derive a secret's wire forms, and `@shipfox/runner-protocol` exposes `runnerToken` so the orchestrator can assemble the mask set.
- d49ee4c: Forward agent step session entries into the logs module as opaque `agent_session` records: the runner tails the pi session file and forwards each verbatim entry over a shared log-stream sink, and the write path stores them with a configurable per-line size cap sized for inline base64 content.
- 2883ab4: Add a stream `kind` to the logs contract and harden the write path. Streams are now identified by `(job, step, attempt, kind)` with two kinds: `log_stream` (process output) and `agent_session` (verbatim, format-agnostic agent JSONL).
  - The record envelope drops `src` to `{v, ts}`; the stdout/stderr pipe moves to `stream` on output, and control records become a flat `type` discriminator with multi-level named groups (`group_id`/`parent_group_id`, capped depth with overflow flattening).
  - The append validator is split into an appendable union and a read union, so a forged server-only `capped`/`runner_lost` tombstone is rejected. `agent_session` lines are stored verbatim after a whole-line, fatal-UTF-8, JSON-well-formedness check within a configurable line cap; the budget cap never injects an in-band tombstone into a session, and close derives its `capped`/`truncated` flags out of band.
  - The append request carries `kind`; the shared body limit and session line cap are configurable with a startup invariant.

- 78d0f7f: Adds runner-produced command metadata groups and terminal failure context to command step log streams.
- 362b3eb: Scope runner log append authorization to the dispatched step attempt carried by the job lease token.
- 655275f: Extracts shared resilient-loop helpers for runner and provisioner backoff, jitter, interruptible sleep, and graceful shutdown handling.
- a5c7562: Adds bounded runner idle polling with startup label validation and terminal session-exhaustion handling.
- 6181819: Adds runner registration sessions with bounded label contracts, session-token auth, and lease-token heartbeat ownership.
- Updated dependencies [eb40964]
- Updated dependencies [5c18360]
- Updated dependencies [05b61f6]
- Updated dependencies [3b45d86]
- Updated dependencies [7a9943d]
- Updated dependencies [b775474]
- Updated dependencies [c17dd6e]
- Updated dependencies [e47f8da]
- Updated dependencies [736249b]
- Updated dependencies [2bc5595]
- Updated dependencies [7b175f5]
- Updated dependencies [68e4022]
- Updated dependencies [940696a]
- Updated dependencies [c7d8b39]
- Updated dependencies [f98c2be]
- Updated dependencies [e9396c9]
- Updated dependencies [6c80f00]
- Updated dependencies [360d06d]
- Updated dependencies [b525dcd]
- Updated dependencies [d49ee4c]
- Updated dependencies [f8f339a]
- Updated dependencies [2883ab4]
- Updated dependencies [78d0f7f]
- Updated dependencies [3afb7e3]
- Updated dependencies [c652a68]
- Updated dependencies [62720ea]
- Updated dependencies [795f440]
- Updated dependencies [3dcd751]
- Updated dependencies [f66f606]
- Updated dependencies [5af4907]
- Updated dependencies [c0a883c]
- Updated dependencies [362b3eb]
- Updated dependencies [e51d464]
- Updated dependencies [d69b164]
- Updated dependencies [2fb3e87]
- Updated dependencies [ef1e917]
- Updated dependencies [655275f]
- Updated dependencies [2933c33]
- Updated dependencies [03d9eae]
- Updated dependencies [a5c7562]
- Updated dependencies [6181819]
- Updated dependencies [3ddde91]
- Updated dependencies [d0cd759]
- Updated dependencies [e699508]
- Updated dependencies [8ecc121]
  - @shipfox/api-workflows-dto@0.1.0
  - @shipfox/runner-agent@0.1.0
  - @shipfox/runner-execution@0.1.0
  - @shipfox/runner-protocol@0.1.0
  - @shipfox/api-secrets-dto@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/runner-logs@0.1.0
  - @shipfox/runner-workspace@0.0.1
  - @shipfox/redact@0.1.0
  - @shipfox/node-resilient-loop@0.0.1
  - @shipfox/config@1.2.0
