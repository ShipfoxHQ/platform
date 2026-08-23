# @shipfox/api-workflows-dto

## 13.1.0

### Minor Changes

- 0d3c2e3: Updates @shipfox/client-agent, @shipfox/client-onboarding, and @shipfox/client-workflows to show
  managed inference providers without exposing workspace credential setup, keep workflow examples
  limited to supported models, and explain managed-provider failures in workflow runs.

### Patch Changes

- Updated dependencies [0d3c2e3]
- Updated dependencies [5c100d6]
- Updated dependencies [ca91dc3]
- Updated dependencies [67aab38]
  - @shipfox/api-agent-dto@13.1.0

## 13.0.0

### Major Changes

- af6b31e: Expose ordered queued and terminal workflow job-execution facts, and release terminal runner reservations once no uncancelled lease remains.

## 12.7.0

### Minor Changes

- 4df5e37: Workflow run list items and run detail now carry `has_started_job_execution`, reporting whether any
  job execution of the attempt reached a runner. Run surfaces no longer show a client-derived `Queued`
  state: the run list and run detail present the API attempt status and duration, and read the new
  field to label a finished run's duration as run or elapsed time.

## 12.6.0

### Minor Changes

- 53b87f0: Distinguish queued and executing jobs in workflow run list status strips.

## 12.5.0

### Minor Changes

- 5b1838c: Expose actionable status reasons and messages when materialized job outputs cannot be persisted.

## 12.3.0

### Minor Changes

- 4b0731e: Adds workflow troubleshooting details, evaluation traces, failure annotations, runner context, step output metadata, and lazy paginated annotation summaries.

## 12.2.0

### Minor Changes

- ce0984d: Preserve structured values when jobs map typed step outputs, normalize them for JSON persistence, and bound materialized job output sizes and entry counts.

### Patch Changes

- @shipfox/api-agent-dto@12.2.0

## 12.1.0

### Minor Changes

- 312a137: Add typed step errors for invalid checkout paths and occupied checkout destinations.

## 12.0.0

### Major Changes

- adf07e7: Cut over workflow and job display names to literal-only `name` fields, with runtime interpolation supported through `run_name` and `execution_name`.
- 54c820e: Add the trigger reference and the current attempt's jobs to each workflow run in the run list response.

  `trigger_reference` carries the repository, ref, commit, and actor a source-control trigger resolved, or null for triggers that resolve none. Jobs arrive as `jobs`, a preview bounded by the new `WORKFLOW_RUN_JOB_PREVIEW_LIMIT`, alongside `job_status_counts` covering every job of the attempt including those past the preview.

- 032d316: Scope checkout credential minting to the currently running checkout step and return its fetch depth.

### Minor Changes

- ee2ce67: Accept a `${{ }}` interpolation in an agent step's `thinking` field. The schema
  still offers the per-harness enum for editor completion, and the dispatcher
  checks the resolved value against the harness levels. An unsupported
  resolved level fails the step.
- f7939c7: Add resolved checkout details as a dedicated step-report field.
- dea1ffd: Expose normalized repository references on listening execution events.
- 285fff2: Persist resolved workflow job execution names and handle dynamic naming failures consistently.
- e44a279: Persist nullable resolved workflow run-name overrides alongside static workflow-name snapshots.
- 35a42bd: Resolve run and agent step working directories against the runner job workspace.
- d77baaa: Add per-definition sequential numbers to workflow runs and expose them in the API and expression context.
- c2a8e54: Normalize checkout target fields for step-dispatch resolution, reject unsupported job-level checkout fields, and keep the workflow model and runtime checkout contracts aligned.
- cb0abfa: Expose the normalized trigger project, repository, ref, and commit in workflow context.

### Patch Changes

- Updated dependencies [ee2ce67]
- Updated dependencies [f78740d]
- Updated dependencies [28daafe]
  - @shipfox/api-agent-dto@12.0.0
  - @shipfox/inter-module@0.2.3

## 10.0.0

### Minor Changes

- 22bf8a2: Classifies runner agent harness startup failures separately from user-fixable agent configuration errors.

### Patch Changes

- Updated dependencies [43ce975]
  - @shipfox/api-agent-dto@10.0.0
  - @shipfox/inter-module@0.2.2

## 9.3.0

### Minor Changes

- 6017e56: Reject new workflow work for suspended or deleted workspaces with stable non-retryable results.

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-agent-dto@9.0.2
  - @shipfox/inter-module@0.2.2

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/api-agent-dto@9.0.1
  - @shipfox/inter-module@0.2.1

## 9.0.0

### Patch Changes

- Updated dependencies [46aa52f]
  - @shipfox/api-agent-dto@9.0.0
  - @shipfox/inter-module@0.2.0

## 8.0.0

### Patch Changes

- Updated dependencies [de559bb]
  - @shipfox/api-agent-dto@8.0.0

## 6.0.0

### Minor Changes

- 23563de: Moves Triggers to the injected Workflows inter-module contract with stable run idempotency and listener delivery commands.
- 23a4dc2: Moves Logs and Integrations to injected Workflows inter-module clients with minimal log and leased agent-tool queries.

### Patch Changes

- Updated dependencies [0bb82a4]
- Updated dependencies [81f9544]
  - @shipfox/api-agent-dto@6.0.0
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 0.1.0

### Minor Changes

- 5c18360: Durable gate restart: a failing gate's `on_failure.restart_from` now records the failed attempt, rewinds the job's step projection from the named earlier step back to pending (opening fresh attempts), and leaves the job running so it re-executes from there — all in one transaction with the report. A per-step attempt cap (default 3) bounds restart loops, exhausting to a `restart_exhausted` failure. Adds the `workflows.step.restart_enqueued` event.
- 7a9943d: Adds the backend contract for per-step execution: job claims mint a lease token for the step API, step reports carry attempts and exit codes, and workflow completion can be signalled through the workflows outbox. The runner-side step loop is intentionally owned by the follow-up runner protocol work.
- 736249b: Expose step attempts in the read API: the run-detail endpoint now returns `current_attempt` on each step plus its per-attempt history (`attempts[]`, with status, exit code, gate result and restart reason), so a restarted step's attempts are visible.
- 2bc5595: Adds workflow-run cancellation across the API, orchestration queue cleanup, event contract, and run-page cancel action.
- 940696a: Adds the credential-free checkout intent type and a checkout-token response DTO (basic/bearer auth with a validated expiry) to the Orchestration DTO package, establishing the contract for runner-managed repository checkouts over the lease-scoped checkout flow.
- e9396c9: Give every runner-dispatched job a synthetic "Set up job" step at position 0 (à la GitHub Actions), so failures that happen around the user steps — workspace preparation today, the repository checkout next — are reported through the existing per-step protocol instead of hanging the job until the lease/timeout fires. The runner prepares the per-job workspace inside this step and reports the outcome; a failed setup flows through the existing fail-job cascade, finalizing the job `failed` in seconds with no user step run.

  Extends `stepErrorDtoSchema` with an optional machine-readable `reason` (`workspace_prep_failed`, `git_unavailable`, `checkout_*`, `setup_aborted`) and a `category` (`setup` | `user`). The runner reports `reason`; the server derives `category` from the step type on read (the runner is an untrusted boundary). The restart resolver now skips the synthetic step so a user step named "Set up job" can never rewind setup mid-job.

- 3afb7e3: Adds job execution success expressions and execution timeouts to workflow documents.
  Renames job execution IDs in auth, runner, workflow, and timeout event contracts to the explicit `jobExecutionId` / `job_execution_id` shape.
- c652a68: Add a single reliable job-terminal event: `workflows.job.terminated` is now written in the same transaction as every terminal job-status flip (normal completion, DAG cancellation, lease-expiry resolution, and timeout), and the run-level `workflows.workflow_run.terminated` is emitted the same way. All workflows event names are aligned on one `WORKFLOWS_<entity>_<verb>` scheme, so the run and job terminal events read as the same event at two scopes.

  Internal breaking change (`WORKFLOWS_JOB_COMPLETED` → `WORKFLOWS_JOB_STEPS_SETTLED`, `WORKFLOW_RUN_*` → `WORKFLOWS_WORKFLOW_RUN_*`, with matching DTO type renames) consumed only within this monorepo.

- c0a883c: Adds the runner-facing per-step endpoints (`POST /runs/jobs/current/steps/next` and `/steps/:stepId/report`) authed by a locally-verified job lease token, with the matching request/response schemas.
- d69b164: Adds workflow run attempt lineage APIs and a run summary switcher for navigating rerun attempts.
- e699508: Adds first-class skipped workflow jobs with persisted status reasons across API DTOs, orchestration, events, and client run views.

### Patch Changes

- eb40964: Add an inline `agent` workflow step that the runner runs with the pi harness. A step is an agent step when it carries `model` + `prompt` and no `run`; it takes a free-text `model`, a single `prompt`, and an optional `thinking` level (default `high`). The step runs to process-success (the agent ran to completion) and reports through the existing step protocol with no runner/backend protocol change, so change quality is judged by a downstream `run` + `gate` step. v1 does not persist the agent's work (no diff, commit, or PR).
- c17dd6e: Adds run-step output emission through `$SHIPFOX_OUTPUT` with runner-side parsing, caps, masking, and report plumbing.
- f98c2be: [api/workflows] Add the lease-authed `POST /runs/jobs/current/checkout-token` endpoint. The runner exchanges its job lease for short-lived, read-only repository checkout credentials. The job's checkout intent is resolved server-side from the authoritative `jobId` claim (`job -> run -> project` source metadata) and minted on demand via the integration service's `createCheckoutSpec()`; no credential material is ever stored on the job/run or queued. `checkoutTokenResponseSchema.auth` stays optional so credential-free providers can return a public clone URL with no token, and `integrationRouteErrorHandler` is exported from `@shipfox/api-integration-core` so the route reuses the shared provider-error mapping.
- b525dcd: Let an agent workflow step pick its pi provider with an optional free-text `provider` field (default `anthropic`), threaded to the runner's pi model lookup, and split agent-step failures into a user-fixable `agent_config_invalid` reason (unknown provider, missing runner credentials, wrong provider/model pair) versus `agent_invocation_failed` for genuine provider/API errors.
- 795f440: Adds the listener orchestration loop for long-lived listening jobs: durable event draining, one execution per buffered event, resolution on until, listening deadline, or max executions, and a run-timeout backstop that resolves active listeners.
- 3dcd751: Adds listener filter snapshots to job activation events and persists them on listener subscriptions.
- 362b3eb: Scope runner log append authorization to the dispatched step attempt carried by the job lease token.
- 2fb3e87: Derives workflow run attempt durations on the client and displays them in the run list and run header.
- ef1e917: Adds listening-job authoring fields and trusted execution context validation for listening jobs.
  Separates workflow identifiers so internal rows use UUID `id`, authored workflow/job/step
  references use `key`, and UI labels use `name`.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- 8ecc121: Track queue/run/finish timing for workflow runs and jobs. Adds nullable `started_at`/`finished_at` to workflow runs and `queued_at`/`started_at`/`finished_at` to jobs, exposed on the run and job DTOs. The runners module emits two new authoritative-timestamp events (`runners.job.queued`, `runners.job.started`) in the same transaction as the enqueue/claim; workflows projects them onto the job row with a first-write-wins `coalesce`, so the at-least-once outbox can redeliver out of order safely. Run `started_at`/`finished_at` and job `finished_at` are stamped in-module at the status transitions. All columns are nullable and eventually consistent, so consumers must treat a missing endpoint as "not yet known" and clamp any duration math.
