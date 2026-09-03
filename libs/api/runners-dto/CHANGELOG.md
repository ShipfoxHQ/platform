# @shipfox/api-runners-dto

## 21.0.0

### Minor Changes

- b5d02d1: Adds renewable inference credential metadata, capability, and failure-reason contracts while preserving legacy behavior.

## 20.0.0

### Minor Changes

- 794f834: Authorizes registration-deadline EC2 runner instances for termination through the backend.

## 19.0.0

### Minor Changes

- 461e3a0: Deliver canonical termination authorizations through poll-demand and reconcile while keeping legacy provisioners wire-compatible.
- b2e6556: Retry authorized EC2 runner instances that remain in stopping after the bounded stopping timeout.
- cd5fb8f: Adds a backward-compatible provider termination-candidate protocol with durable, state-checked authorization.

### Patch Changes

- Updated dependencies [b416c4c]
  - @shipfox/runner-labels@0.2.1
  - @shipfox/inter-module@0.2.3

## 18.0.0

### Major Changes

- defc3e6: Remove ephemeral runner registration-token issuance and consumption from the public runner APIs and token helpers.

### Minor Changes

- fff528a: Adds lifecycle capability negotiation for runner job claims and records the selected local isolation timeout.
- 60061fb: Add the renewable Git capability to the runner DTO contract.
- a50e2dc: Expose the `cancellation_reason` field so consumers can distinguish user cancellation from maximum-duration timeouts.

## 16.0.0

### Patch Changes

- 8eda9d4: Makes runner reservation accounting self-correcting across claimed, terminal, released, and unlaunched runner units, and labels reservation-release metrics by lifecycle surface including first-claim releases.

## 14.0.0

### Minor Changes

- 69a92c4: Adds `installation_runners` (`managed` or `none`) to the active-provisioners response. The value is `managed` when reserved runner labels are configured or an installation-scope provisioner token is active, so client consumers can determine whether the installation provides runner capacity.

## 13.0.0

### Major Changes

- af6b31e: Expose ordered queued and terminal workflow job-execution facts, and release terminal runner reservations once no uncancelled lease remains.

## 12.4.0

### Minor Changes

- 9e16946: Runners are enrolled only when the reservation still has capacity, and partial-enrollment errors now report reservation shortfalls separately from launch grants.
- 4fa8526: Adds opt-in reconciliation data so provisioners can retry intended reservation assignments.

## 12.2.0

### Patch Changes

- 78b771c: Accept provider-specific reservation TTLs in runner demand polling and enforce a server-side ceiling.
- Updated dependencies [df2ed79]
  - @shipfox/runner-labels@0.2.0

## 12.0.0

### Patch Changes

- Updated dependencies [f78740d]
  - @shipfox/inter-module@0.2.3

## 10.2.0

### Minor Changes

- c9a188d: Add administrator creation, bounded inspection, and revocation for installation provisioner tokens.
- 8678943: Add a bounded administrator inventory for installation-managed runner instances.
- 6be5a54: Make managed runner assignment polling use an explicit bounded wait and retry transport timeouts while the control session remains healthy.

## 10.0.0

### Minor Changes

- e9280fc: Add an observer-authorized administrator workspace lookup with bounded safe summaries,
  best-effort job counts, and a neutral unavailable-workspace member experience for
  suspended or deleted workspaces.
- 837bf5d: Stores runner reservation intent and promotes it during enrollment for lower activation latency.

### Patch Changes

- 3f5610b: Allow provisioner demand polls to advertise up to 1000 templates.
  - @shipfox/inter-module@0.2.2
  - @shipfox/runner-labels@0.1.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/inter-module@0.2.2
  - @shipfox/runner-labels@0.1.3

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
  - @shipfox/runner-labels@0.1.2
  - @shipfox/inter-module@0.2.1

## 7.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.

## 7.0.0

### Major Changes

- bc7cfdc: Migrates provisioners to bootstrap runner instances with explicit reservation assignment.

## 6.0.0

### Major Changes

- 8bdc149: Adds scoped workspace and installation provisioner identities with explicit authorization boundaries.
- 6741be8: Renames the provisioned-runner lifecycle contract to runner instances and provider runner IDs.

### Minor Changes

- e52513c: Adds provisioner-owned planned capacity with immutable provider runner attachment.
- b70f920: Adds assigned runner activation and descendant provisioner revocation.
- 9006b75: Adds the Runners inter-module contract and requires the injected Runners client when composing Workflows.
- 3cda0c6: Adds fresh workspace provisioner capability snapshots for managed fallback policy.
- 795e293: Adds installation-scoped fallback demand reservations across eligible workspaces.
- e10c829: Adds immutable capacity assignments while retaining the registration-token protocol for existing provisioners.
- b00ed29: Adds runner bootstrap enrollment and isolated pre-workspace control sessions.

### Patch Changes

- Updated dependencies [81f9544]
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/runner-labels@0.1.1

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/runner-labels@0.1.0

## 0.1.0

### Minor Changes

- 8100b48: Adds the provisioned-runner reconcile endpoint and shared request/response schemas for provisioner state recovery.
- 7a9943d: Adds the backend contract for per-step execution: job claims mint a lease token for the step API, step reports carry attempts and exit codes, and workflow completion can be signalled through the workflows outbox. The runner-side step loop is intentionally owned by the follow-up runner protocol work.
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

- 3afb7e3: Adds job execution success expressions and execution timeouts to workflow documents.
  Renames job execution IDs in auth, runner, workflow, and timeout event contracts to the explicit `jobExecutionId` / `job_execution_id` shape.
- fb64f13: Adds a job lease capability token (HS256, `verifyJobLeaseToken` plus the claims schema) so runner step calls can be authenticated in-process without a hop back to Scheduling.
- 03d9eae: Adds runner-advertised tool capabilities to registration, heartbeat, persistence, and runner protocol reporting.
- 6181819: Adds runner registration sessions with bounded label contracts, session-token auth, and lease-token heartbeat ownership.

### Patch Changes

- 2325d76: Adds provisioned-runner terminate intent signals for cancelled bound jobs across runner polling and reconcile responses.
- c0a883c: Moves the job lease capability token codec and its claims schema from the runners packages into api-auth/api-auth-dto, renaming its config to `AUTH_JOB_LEASE_TOKEN_*`, so all signed-token codecs live with authentication. Adds a shared leased-job auth context for request-scoped lease claims, and a shared `createLeaseTokenAuthMethod` (the `leased-job` auth method) registered on the auth module so any feature module can protect routes with a lease token by name.
- 247cbd6: Adds label-aware runner job claiming with shared runner-label validation and required-label orchestration.
- 62720ea: Consolidates runner label canonicalization on `@shipfox/runner-labels` across runner scheduling and protocol code.
- 88b9793: Adds runner demand polling schemas for provisioner reservation requests and responses.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- a5c7562: Adds bounded runner idle polling with startup label validation and terminal session-exhaustion handling.
- 8ecc121: Track queue/run/finish timing for workflow runs and jobs. Adds nullable `started_at`/`finished_at` to workflow runs and `queued_at`/`started_at`/`finished_at` to jobs, exposed on the run and job DTOs. The runners module emits two new authoritative-timestamp events (`runners.job.queued`, `runners.job.started`) in the same transaction as the enqueue/claim; workflows projects them onto the job row with a first-write-wins `coalesce`, so the at-least-once outbox can redeliver out of order safely. Run `started_at`/`finished_at` and job `finished_at` are stamped in-module at the status transitions. All columns are nullable and eventually consistent, so consumers must treat a missing endpoint as "not yet known" and clamp any duration math.
- Updated dependencies [61de795]
  - @shipfox/runner-labels@0.0.1
