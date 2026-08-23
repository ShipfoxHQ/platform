# @shipfox/api-runners

## 13.1.0

### Patch Changes

- 7de2e30: Release runner reservation units when a provisioned runner claims its first job.
- Updated dependencies [0d3c2e3]
  - @shipfox/api-workflows-dto@13.1.0

## 13.0.0

### Major Changes

- af6b31e: Expose ordered queued and terminal workflow job-execution facts, and release terminal runner reservations once no uncancelled lease remains.

### Patch Changes

- Updated dependencies [af6b31e]
  - @shipfox/api-runners-dto@13.0.0
  - @shipfox/api-workflows-dto@13.0.0

## 12.7.0

### Patch Changes

- 7a5e247: Release runner reservation units when a provisioner reports a terminal runner.
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

## 12.4.1

### Patch Changes

- f8eb3b5: Record job execution queue-time histograms for runner SLI dashboards.
- 38e0acb: Downgrades expected runner assignment retries to debug logging. Adds the
  `runners_provider_runner_created_to_control_session`,
  `runners_provider_runner_control_session_to_assignment`,
  `runners_provider_runner_assignment_to_activation`,
  `runners_provider_runner_activation_to_first_claim`,
  `runners_provider_runner_assignment_rejected`,
  `runners_provider_runner_by_phase`, and
  `runners_provider_runner_by_phase_oldest_age` metrics.

## 12.4.0

### Minor Changes

- 9e16946: Runners are enrolled only when the reservation still has capacity, and partial-enrollment errors now report reservation shortfalls separately from launch grants.
- 4fa8526: Adds opt-in reconciliation data so provisioners can retry intended reservation assignments.

### Patch Changes

- 99d798e: Repairs provider-reported runner assignments before activation and preserves reservation capacity during retries.
- c98cd02: Deduct only pending launch units from provisioner capacity across reservation polls.
- 67cc90d: Avoid provisional bound reservation writes when no runner can be rebound.
- 2dbe43b: Split rebound and launch reservations so rebinding an idle runner does not create duplicate launch capacity.
- e930624: Adds low-cardinality metrics and debug logs that identify why runner activation token issuance stops.
- 57a6407: Reclaims demand-backed runners that never activate after their independent recovery window expires.
- e41fc8d: Require provisioner reservation token and assignment flows to use launch reservations.
- 0c2cee4: Align demand polling and reservation cleanup runner row lock ordering.
  Recheck runner eligibility before binding after row-lock acquisition.
- Updated dependencies [9e16946]
- Updated dependencies [4fa8526]
  - @shipfox/api-runners-dto@12.4.0

## 12.3.0

### Patch Changes

- ed3ea25: Raise the default runner reservation TTL ceiling to 600 seconds so longer EC2 launch budgets are accepted while the cap still limits unreleased-reservation demand.
- 72fb19d: Allow idle runners with expired or deleted intended or assigned reservations to be rebound on the next demand poll.
- 32bc717: Preserves committed runner assignment metadata during enrollment.
- 4bd55e8: Adds a service gauge for enrolled runners without a recent provisioner report after the stale-runner grace window.
- 4a5e847: Uses provider reservation expiry as the activation grace period before stale runner assignments are rebound.
- Updated dependencies [4b0731e]
  - @shipfox/api-workflows-dto@12.3.0

## 12.2.0

### Minor Changes

- d7af255: Count bounded runner reservation promotion failures during enrollment.

### Patch Changes

- 947a5bc: Clear stale intended runner reservations when reservation rows are deleted.
- 78b771c: Accept provider-specific reservation TTLs in runner demand polling and enforce a server-side ceiling.
- 9e1d2e9: Reserve configured runner labels for installation-scope provisioners.
- Updated dependencies [78b771c]
- Updated dependencies [df2ed79]
- Updated dependencies [ce0984d]
  - @shipfox/api-runners-dto@12.2.0
  - @shipfox/runner-labels@0.2.0
  - @shipfox/api-workflows-dto@12.2.0
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
- 9ebc5b4: Add an authenticated, rate-limited workspace slug availability endpoint.
- d3222a9: Atomically reconcile pending and running runner state when a job execution reaches a terminal state.
- Updated dependencies [ee2ce67]
- Updated dependencies [f7939c7]
- Updated dependencies [f78740d]
- Updated dependencies [dea1ffd]
- Updated dependencies [adf07e7]
- Updated dependencies [285fff2]
- Updated dependencies [e44a279]
- Updated dependencies [f13e8bb]
- Updated dependencies [9ebc5b4]
- Updated dependencies [54c820e]
- Updated dependencies [35a42bd]
- Updated dependencies [d77baaa]
- Updated dependencies [34a5639]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [cb0abfa]
  - @shipfox/api-workflows-dto@12.0.0
  - @shipfox/api-auth-dto@12.0.0
  - @shipfox/api-common-dto@12.0.0
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-fastify@0.4.1
  - @shipfox/node-module@1.0.5
  - @shipfox/node-postgres@0.5.0
  - @shipfox/node-rate-limit@0.4.0
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/api-runners-dto@12.0.0
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-outbox@0.2.6

## 11.0.0

### Patch Changes

- Updated dependencies [25158c8]
  - @shipfox/api-auth-context@11.0.0

## 10.2.0

### Minor Changes

- c9a188d: Add administrator creation, bounded inspection, and revocation for installation provisioner tokens.
- 8678943: Add a bounded administrator inventory for installation-managed runner instances.

### Patch Changes

- 3e257f5: Binds idle enrolled runners to newly granted reservations so prewarmed capacity can activate queued jobs.
- 6be5a54: Make managed runner assignment polling use an explicit bounded wait and retry transport timeouts while the control session remains healthy.
- Updated dependencies [c9a188d]
- Updated dependencies [8678943]
- Updated dependencies [95d1456]
- Updated dependencies [0773b85]
- Updated dependencies [6be5a54]
  - @shipfox/api-runners-dto@10.2.0
  - @shipfox/api-auth-dto@10.2.0
  - @shipfox/api-auth-context@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [fb34b6a]
  - @shipfox/api-auth-dto@10.1.0
  - @shipfox/api-auth-context@10.1.0

## 10.0.0

### Minor Changes

- e9280fc: Add an observer-authorized administrator workspace lookup with bounded safe summaries,
  best-effort job counts, and a neutral unavailable-workspace member experience for
  suspended or deleted workspaces.
- 837bf5d: Stores runner reservation intent and promotes it during enrollment for lower activation latency.

### Patch Changes

- a48ad8c: Allows provisioner assignment retries after reservation cleanup.
- 2402bdb: Keep runner assignment polls open through transient activation-token races.
- Updated dependencies [6054364]
- Updated dependencies [74f9e31]
- Updated dependencies [22bf8a2]
- Updated dependencies [e9280fc]
- Updated dependencies [837bf5d]
- Updated dependencies [3f5610b]
  - @shipfox/api-auth-dto@10.0.0
  - @shipfox/node-fastify@0.4.0
  - @shipfox/api-workflows-dto@10.0.0
  - @shipfox/api-runners-dto@10.0.0
  - @shipfox/api-auth-context@10.0.0
  - @shipfox/node-module@1.0.4
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/runner-labels@0.1.3
  - @shipfox/node-auth-root-key@0.2.3
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-postgres@0.4.4
  - @shipfox/node-rate-limit@0.3.2
  - @shipfox/node-temporal@0.4.4
  - @shipfox/node-tokens@0.3.2

## 9.3.0

### Patch Changes

- Updated dependencies [10cf63c]
- Updated dependencies [4425c6d]
- Updated dependencies [6017e56]
  - @shipfox/api-auth-dto@9.3.0
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/api-workflows-dto@9.3.0
  - @shipfox/api-auth-context@9.3.0
  - @shipfox/node-fastify@0.3.4
  - @shipfox/node-module@1.0.3
  - @shipfox/node-temporal@0.4.4

## 9.2.0

### Patch Changes

- Updated dependencies [456c884]
  - @shipfox/api-auth-dto@9.2.0
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
  - @shipfox/api-auth-dto@9.0.2
  - @shipfox/api-runners-dto@9.0.2
  - @shipfox/api-workflows-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-auth-root-key@0.2.3
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-error-monitoring@0.2.2
  - @shipfox/node-fastify@0.3.2
  - @shipfox/node-module@1.0.1
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-postgres@0.4.4
  - @shipfox/node-rate-limit@0.3.2
  - @shipfox/node-temporal@0.4.2
  - @shipfox/node-tokens@0.3.2
  - @shipfox/runner-labels@0.1.3

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
- Updated dependencies [154e03f]
  - @shipfox/runner-labels@0.1.2
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/api-auth-dto@9.0.1
  - @shipfox/api-runners-dto@9.0.1
  - @shipfox/api-workflows-dto@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/inter-module@0.2.1
  - @shipfox/node-auth-root-key@0.2.2
  - @shipfox/node-drizzle@0.3.3
  - @shipfox/node-error-monitoring@0.2.1
  - @shipfox/node-fastify@0.3.1
  - @shipfox/node-module@1.0.0
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-outbox@0.2.5
  - @shipfox/node-postgres@0.4.3
  - @shipfox/node-rate-limit@0.3.1
  - @shipfox/node-temporal@0.4.1
  - @shipfox/node-tokens@0.3.1

## 9.0.0

### Patch Changes

- c279061: Improves release verification with owner-defined packed contracts, discovery-driven artifact checks, and an early publication preflight.
  - @shipfox/api-auth-context@9.0.0
  - @shipfox/api-auth-dto@7.1.0
  - @shipfox/api-runners-dto@7.0.1
  - @shipfox/api-workflows-dto@9.0.0
  - @shipfox/config@1.2.2
  - @shipfox/inter-module@0.2.0
  - @shipfox/runner-labels@0.1.1
  - @shipfox/node-auth-root-key@0.2.1
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-outbox@0.2.4
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-rate-limit@0.3.0
  - @shipfox/node-temporal@0.4.0
  - @shipfox/node-tokens@0.3.0

## 8.0.0

### Patch Changes

- b15f3a7: Removes Auth implementation dependencies from consumer test boundaries.
  - @shipfox/api-workflows-dto@8.0.0

## 7.1.0

### Patch Changes

- ac42c96: Adds boundary-owned reporting for unexpected API runtime failures while preserving expected client and provider outcomes.
- Updated dependencies [ac42c96]
- Updated dependencies [769d919]
- Updated dependencies [6ce08c0]
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-temporal@0.4.0
  - @shipfox/api-auth-dto@7.1.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/api-auth-context@7.1.0

## 7.0.2

### Patch Changes

- Updated dependencies [81c8f33]
  - @shipfox/node-auth-root-key@0.2.1

## 7.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/api-runners-dto@7.0.1

## 7.0.0

### Major Changes

- bc7cfdc: Migrates provisioners to bootstrap runner instances with explicit reservation assignment.

### Patch Changes

- Updated dependencies [bc7cfdc]
  - @shipfox/api-runners-dto@7.0.0

## 6.0.0

### Major Changes

- 8bdc149: Adds scoped workspace and installation provisioner identities with explicit authorization boundaries.
- 6741be8: Renames the provisioned-runner lifecycle contract to runner instances and provider runner IDs.

### Minor Changes

- e52513c: Adds provisioner-owned planned capacity with immutable provider runner attachment.
- b70f920: Adds assigned runner activation and descendant provisioner revocation.
- add4c77: Adds host-configurable runners composition with batched installation workspace eligibility policy.
- 3cda0c6: Adds fresh workspace provisioner capability snapshots for managed fallback policy.
- 795e293: Adds installation-scoped fallback demand reservations across eligible workspaces.
- e10c829: Adds immutable capacity assignments while retaining the registration-token protocol for existing provisioners.
- b00ed29: Adds runner bootstrap enrollment and isolated pre-workspace control sessions.

### Patch Changes

- 6a52909: Replaces separate API auth secrets with domain-separated keys derived from one required AUTH_ROOT_KEY.
- 9006b75: Adds the Runners inter-module contract and requires the injected Runners client when composing Workflows.
- 112c0fa: Adds the Auth inter-module token-minting contract and removes Auth implementation and configuration coupling from its consumers.
- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- Updated dependencies [e52513c]
- Updated dependencies [b70f920]
- Updated dependencies [23563de]
- Updated dependencies [6a52909]
- Updated dependencies [e6eba5b]
- Updated dependencies [54ce48b]
- Updated dependencies [9006b75]
- Updated dependencies [3cda0c6]
- Updated dependencies [ba2e3dc]
- Updated dependencies [f4bc2eb]
- Updated dependencies [c0162b0]
- Updated dependencies [7ac43a4]
- Updated dependencies [a01e917]
- Updated dependencies [112c0fa]
- Updated dependencies [8bdc149]
- Updated dependencies [795e293]
- Updated dependencies [e10c829]
- Updated dependencies [3810996]
- Updated dependencies [23a4dc2]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [4a91956]
- Updated dependencies [81f9544]
- Updated dependencies [6741be8]
  - @shipfox/api-runners-dto@6.0.0
  - @shipfox/node-tokens@0.3.0
  - @shipfox/api-workflows-dto@6.0.0
  - @shipfox/node-auth-root-key@0.2.0
  - @shipfox/node-rate-limit@0.3.0
  - @shipfox/api-auth-dto@6.0.0
  - @shipfox/node-module@0.4.0
  - @shipfox/node-temporal@0.3.2
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-outbox@0.2.4
  - @shipfox/api-auth-context@6.0.0
  - @shipfox/node-fastify@0.2.4
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/api-auth@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-runners-dto@5.0.0
  - @shipfox/api-workflows-dto@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-module@0.3.2
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-outbox@0.2.3
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-rate-limit@0.2.1
  - @shipfox/node-temporal@0.3.1
  - @shipfox/node-tokens@0.2.1
  - @shipfox/runner-labels@0.1.1

## 4.0.0

### Patch Changes

- Updated dependencies [0b0a9c2]
- Updated dependencies [bbba3b7]
  - @shipfox/api-auth@4.0.0
  - @shipfox/node-drizzle@0.3.0
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
  - @shipfox/api-auth@3.0.0
  - @shipfox/node-temporal@0.3.0
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/node-fastify@0.2.2
  - @shipfox/api-auth-context@3.0.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [0cd6dd4]
- Updated dependencies [a68458a]
- Updated dependencies [6eba800]
- Updated dependencies [c31a7e0]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-module@0.2.0
  - @shipfox/node-temporal@0.2.0
  - @shipfox/api-auth@2.0.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-runners-dto@2.0.0
  - @shipfox/api-workflows-dto@2.0.0
  - @shipfox/node-rate-limit@0.2.0
  - @shipfox/node-tokens@0.2.0
  - @shipfox/runner-labels@0.1.0
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
  - @shipfox/api-auth@0.1.2
  - @shipfox/node-module@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/api-auth@0.1.1
  - @shipfox/node-module@0.1.1
  - @shipfox/node-outbox@0.1.1

## 0.1.0

### Minor Changes

- 8100b48: Adds the provisioned-runner reconcile endpoint and shared request/response schemas for provisioner state recovery.
- 7a9943d: Adds the backend contract for per-step execution: job claims mint a lease token for the step API, step reports carry attempts and exit codes, and workflow completion can be signalled through the workflows outbox. The runner-side step loop is intentionally owned by the follow-up runner protocol work.
- 2bc5595: Adds workflow-run cancellation across the API, orchestration queue cleanup, event contract, and run-page cancel action.
- c47be09: Reshape Scheduling around runner job leases. Jobs are now enqueued with `workflowRunId`, `workflowRunAttemptId`, `jobId`, and `jobExecutionId`; the claim route mints a job lease token and returns the same workflow/job identity tuple. The stuck-job detector emits `runners.job.lease_expired` with that tuple when a lease expires.
- f9f059e: Cut the runner protocol over to per-step pull/report and remove the job-atomic path.

  The job workflow now terminates on two signals: `job-finished` (raised by
  `recordStepResult` on step exhaustion) and `job-lease-expired` (raised by the new
  `runners.job.lease_expired` subscriber). A precedence ladder keeps a genuinely
  finished job from being failed by a late lease expiry, and the lease-expiry branch
  re-derives the outcome from the authoritative step projection in a single
  transaction (server state is the final gate). On finish the workflow releases the
  lease via `releaseJob` (deleting both the running and any orphaned pending row);
  release is best-effort so a Scheduling outage never blocks the run DAG.

  Removed the atomic path end to end: the runner `POST /runners/jobs/:jobId/complete`
  route, the `RUNNER_JOB_COMPLETED` event, `finalizeRunningJob`/`completeJob`, the
  `applyStepResults*` apply path and its workflow subscriber, and the dead
  `jobPayload*`/`complete-job` DTO schemas. The runner now parses the step-less claim
  response, and `claimPendingJob` drops an orphan pending row instead of poison-looping.

  Internal breaking change (deleted exported DTOs/events and a runner route, plus a
  Temporal signal rename) consumed only within this monorepo; backend and agent ship
  together.

- 1c1fb3e: Adds shared fixed-window rate limiting for provisioner token minting and ephemeral runner registration.
- fb64f13: Adds a job lease capability token (HS256, `verifyJobLeaseToken` plus the claims schema) so runner step calls can be authenticated in-process without a hop back to Scheduling.
- 03d9eae: Adds runner-advertised tool capabilities to registration, heartbeat, persistence, and runner protocol reporting.
- 6181819: Adds runner registration sessions with bounded label contracts, session-token auth, and lease-token heartbeat ownership.

### Patch Changes

- 2325d76: Adds provisioned-runner terminate intent signals for cancelled bound jobs across runner polling and reconcile responses.
- 89026d5: Fixes provisioned-runner reconcile results when fresh lifecycle reports commit during stale-absent termination.
- c0a883c: Moves the job lease capability token codec and its claims schema from the runners packages into api-auth/api-auth-dto, renaming its config to `AUTH_JOB_LEASE_TOKEN_*`, so all signed-token codecs live with authentication. Adds a shared leased-job auth context for request-scoped lease claims, and a shared `createLeaseTokenAuthMethod` (the `leased-job` auth method) registered on the auth module so any feature module can protect routes with a lease token by name.
- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- 5729548: Stuck-job expiry now reaps a bounded batch in one transaction instead of N+1: a single `DELETE … RETURNING` (oldest-first, `FOR UPDATE SKIP LOCKED`, capped at 100 per tick) feeds a multi-row outbox insert via the new `writeOutboxEvents` helper. Behavior is unchanged (same rows reaped, one `runners.job.lease_expired` event per reaped job, same orphan-pending sweep).
- e250c4c: Propagates `projectId` end-to-end into the job lease token. Workflows sources the `{workspaceId, projectId, workflowRunId, workflowRunAttemptId, jobId, jobExecutionId}` identity tuple and threads it through the runner pending/running job tables and lease claims. This is lease-shape groundwork for per-project log-ingest authorization; the stream-stamping consumer lands separately.
- 2617db9: Folds the runner database migrations into a single baseline and drops six redundant indexes; the resulting schema is unchanged.
- 247cbd6: Adds label-aware runner job claiming with shared runner-label validation and required-label orchestration.
- 1d98b19: Rewrites the pending-job claim query with the Drizzle query builder instead of raw SQL, keeping the same FOR UPDATE SKIP LOCKED locking behavior.
- 5823bac: Removes the per-request workspace existence and status check from provisioner token auth, severing the last `@shipfox/api-workspaces` dependency in `@shipfox/api-runners`; workspace-status enforcement on the provisioner path moves to the upcoming workspace removal/disable work.
- 75520ff: Add the foundation for metrics observability. `@shipfox/node-module` gains an optional `metrics` hook on `ShipfoxModule` plus `registerModuleMetrics`, a declarative slot for modules to register service-level metrics (observable gauges) once at app startup, kept separate from `initializeModules` so unit tests never bind the metrics port. `@shipfox/api-runners` is instrumented as the worked example across both planes: instance counters for job enqueue, claim, and lease expiry recorded inline, and `runners_pending_jobs` / `runners_running_jobs` observable gauges over a new `getJobQueueDepth` query wired through the module hook.
- 62720ea: Consolidates runner label canonicalization on `@shipfox/runner-labels` across runner scheduling and protocol code.
- b855d6f: Adds reconciliation observability metrics for provisioned-runner divergence and terminate-intent reconciliation.
- 362b3eb: Scope runner log append authorization to the dispatched step attempt carried by the job lease token.
- 3bea87f: Adds a typed `subscriberFactory` that binds each outbox event name to its payload type at construction, so subscriber handlers receive a typed `(payload, event)` and the per-handler `event.payload as X` casts are gone; a private brand makes the factory the only way to build a module subscriber.
- 82d22e4: Make the workspace-membership gate stateless. `requireWorkspaceAccess` now lives in `@shipfox/api-auth-context` and authorizes a request purely from the verified session-token claims, replacing the `requireMembership` gate in `@shipfox/api-workspaces` that read the workspace row from the database on every workspace-scoped request. Membership and role already travel in the token, so the check needs no database access.

  This removes the per-request database read and severs the runtime dependency on `@shipfox/api-workspaces` from feature modules that only needed the membership gate (integration providers, secrets, projects, agent, runners). Workspace existence and `active`-status enforcement, which no code path currently exercises, moves off the hot path; enforce it at token issuance when workspace suspension is introduced.

- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- 8b9c3e0: Runs the API runners and integration core test suites without per-file Vitest module isolation, removing runner auth-helper mocks and cleaning up module-reset handling for shared test modules.
- 0dd23a7: Warns on agent tool capability mismatches during dispatch without blocking label-matched runners.
- 8ecc121: Track queue/run/finish timing for workflow runs and jobs. Adds nullable `started_at`/`finished_at` to workflow runs and `queued_at`/`started_at`/`finished_at` to jobs, exposed on the run and job DTOs. The runners module emits two new authoritative-timestamp events (`runners.job.queued`, `runners.job.started`) in the same transaction as the enqueue/claim; workflows projects them onto the job row with a first-write-wins `coalesce`, so the at-least-once outbox can redeliver out of order safely. Run `started_at`/`finished_at` and job `finished_at` are stamped in-module at the status transitions. All columns are nullable and eventually consistent, so consumers must treat a missing endpoint as "not yet known" and clamp any duration math.
- Updated dependencies [eb40964]
- Updated dependencies [5c18360]
- Updated dependencies [34ba284]
- Updated dependencies [8100b48]
- Updated dependencies [5707d6d]
- Updated dependencies [7a9943d]
- Updated dependencies [b9c3f32]
- Updated dependencies [2325d76]
- Updated dependencies [d02c5fd]
- Updated dependencies [c17dd6e]
- Updated dependencies [a81b68c]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [736249b]
- Updated dependencies [2bc5595]
- Updated dependencies [7b175f5]
- Updated dependencies [c47be09]
- Updated dependencies [f9f059e]
- Updated dependencies [940696a]
- Updated dependencies [f98c2be]
- Updated dependencies [e9396c9]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [f92122b]
- Updated dependencies [e250c4c]
- Updated dependencies [b525dcd]
- Updated dependencies [b0a0e1a]
- Updated dependencies [857fd73]
- Updated dependencies [1c1fb3e]
- Updated dependencies [3afb7e3]
- Updated dependencies [1daf39a]
- Updated dependencies [247cbd6]
- Updated dependencies [c652a68]
- Updated dependencies [fb64f13]
- Updated dependencies [75520ff]
- Updated dependencies [62720ea]
- Updated dependencies [795f440]
- Updated dependencies [3dcd751]
- Updated dependencies [c0a883c]
- Updated dependencies [362b3eb]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [3bea87f]
- Updated dependencies [82d22e4]
- Updated dependencies [d69b164]
- Updated dependencies [2fb3e87]
- Updated dependencies [ef1e917]
- Updated dependencies [61de795]
- Updated dependencies [88b9793]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [03d9eae]
- Updated dependencies [a5c7562]
- Updated dependencies [6181819]
- Updated dependencies [e699508]
- Updated dependencies [9c149d1]
- Updated dependencies [fb64f13]
- Updated dependencies [8ecc121]
  - @shipfox/api-workflows-dto@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-runners-dto@0.1.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-auth@0.1.0
  - @shipfox/node-tokens@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/node-rate-limit@0.1.0
  - @shipfox/runner-labels@0.0.1
  - @shipfox/config@1.2.0
