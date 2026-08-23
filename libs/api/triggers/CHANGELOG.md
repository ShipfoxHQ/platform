# @shipfox/api-triggers

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
- Updated dependencies [3e7fe76]
  - @shipfox/api-workflows-dto@12.3.0
  - @shipfox/expression@2.2.0
  - @shipfox/api-definitions-dto@12.3.0

## 12.2.0

### Minor Changes

- ce0984d: Preserve structured values when jobs map typed step outputs, normalize them for JSON persistence, and bound materialized job output sizes and entry counts.

### Patch Changes

- 214b8f2: Expose execution and run numeric fields as CEL integers, preserve zero-based execution indices,
  and keep listener filter snapshots aligned with live CEL values after persistence.
- Updated dependencies [7901a60]
- Updated dependencies [ce0984d]
  - @shipfox/api-integration-core-dto@12.2.0
  - @shipfox/expression@2.1.0
  - @shipfox/api-workflows-dto@12.2.0
  - @shipfox/workflow-document@3.0.1
  - @shipfox/node-opentelemetry@0.6.4
  - @shipfox/api-definitions-dto@12.2.0
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
- dea1ffd: Expose normalized repository references on listening execution events.
- 4d246d4: Align predicate validation and runtime evaluation with field-specific context contracts.
- cb0abfa: Expose the normalized trigger project, repository, ref, and commit in workflow context.
- Updated dependencies [ee2ce67]
- Updated dependencies [7c4116e]
- Updated dependencies [5d2c9cf]
- Updated dependencies [e95fdf4]
- Updated dependencies [3d91d1d]
- Updated dependencies [f7939c7]
- Updated dependencies [89f2c18]
- Updated dependencies [045895c]
- Updated dependencies [f78740d]
- Updated dependencies [9e1d599]
- Updated dependencies [dea1ffd]
- Updated dependencies [adf07e7]
- Updated dependencies [3f781ee]
- Updated dependencies [9fdd5e4]
- Updated dependencies [285fff2]
- Updated dependencies [e44a279]
- Updated dependencies [4d246d4]
- Updated dependencies [f13e8bb]
- Updated dependencies [4444079]
- Updated dependencies [869a792]
- Updated dependencies [54c820e]
- Updated dependencies [35a42bd]
- Updated dependencies [d77baaa]
- Updated dependencies [41d558c]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [54c820e]
- Updated dependencies [cb0abfa]
- Updated dependencies [ee2ce67]
- Updated dependencies [7f90b0c]
  - @shipfox/workflow-document@3.0.0
  - @shipfox/api-definitions-dto@12.0.0
  - @shipfox/api-workflows-dto@12.0.0
  - @shipfox/expression@2.0.0
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-fastify@0.4.1
  - @shipfox/node-module@1.0.5
  - @shipfox/api-integration-core-dto@12.0.0
  - @shipfox/node-postgres@0.5.0
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-outbox@0.2.6

## 11.0.0

### Major Changes

- 25158c8: Carry workspace lifecycle status in JWT membership claims and enforce suspended or inactive access at the stateless workspace gate while keeping access-token verification stateless.

  `getAuthenticatedSessionContext()` now reads refresh-session metadata from verified access-token claims without checking active refresh-session state; revoking a refresh session does not invalidate an already-issued access token.

### Patch Changes

- Updated dependencies [71d9ba4]
- Updated dependencies [25158c8]
  - @shipfox/expression@1.2.1
  - @shipfox/api-auth-context@11.0.0
  - @shipfox/api-definitions-dto@11.0.0

## 10.2.0

### Patch Changes

- @shipfox/api-auth-context@10.2.0

## 10.1.0

### Patch Changes

- @shipfox/api-auth-context@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [74f9e31]
- Updated dependencies [22bf8a2]
- Updated dependencies [a713231]
  - @shipfox/node-fastify@0.4.0
  - @shipfox/api-workflows-dto@10.0.0
  - @shipfox/expression@1.2.0
  - @shipfox/api-auth-context@10.0.0
  - @shipfox/node-module@1.0.4
  - @shipfox/api-definitions-dto@10.0.0
  - @shipfox/api-integration-core-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-postgres@0.4.4
  - @shipfox/node-temporal@0.4.4
  - @shipfox/workflow-document@2.1.3
  - @shipfox/api-triggers-dto@9.0.2

## 9.3.0

### Minor Changes

- 6017e56: Reject new workflow work for suspended or deleted workspaces with stable non-retryable results.

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
  - @shipfox/api-definitions-dto@9.0.2
  - @shipfox/api-integration-core-dto@9.0.2
  - @shipfox/api-triggers-dto@9.0.2
  - @shipfox/api-workflows-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/expression@1.1.5
  - @shipfox/inter-module@0.2.2
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
  - @shipfox/expression@1.1.4
  - @shipfox/workflow-document@2.1.2
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/api-definitions-dto@9.0.1
  - @shipfox/api-integration-core-dto@9.0.1
  - @shipfox/api-triggers-dto@9.0.1
  - @shipfox/api-workflows-dto@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/inter-module@0.2.1
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

- Updated dependencies [02974d6]
- Updated dependencies [4a6d124]
  - @shipfox/api-integration-core-dto@9.0.0
  - @shipfox/api-auth-context@9.0.0
  - @shipfox/api-definitions-dto@6.0.0
  - @shipfox/api-triggers-dto@5.0.0
  - @shipfox/api-workflows-dto@9.0.0
  - @shipfox/config@1.2.2
  - @shipfox/inter-module@0.2.0
  - @shipfox/expression@1.1.3
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

- Updated dependencies [7f227c6]
  - @shipfox/api-integration-core-dto@8.0.0
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
  - @shipfox/api-projects@7.1.0

## 7.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.

## 7.0.0

### Patch Changes

- 10d60f6: Adds deterministic E2E listener-subscription readiness checks for workflow batching tests.

## 6.0.0

### Major Changes

- 23563de: Moves Triggers to the injected Workflows inter-module contract with stable run idempotency and listener delivery commands.

### Patch Changes

- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- Updated dependencies [a8f0545]
- Updated dependencies [0bb82a4]
- Updated dependencies [23563de]
- Updated dependencies [54ce48b]
- Updated dependencies [f4bc2eb]
- Updated dependencies [c0162b0]
- Updated dependencies [7ac43a4]
- Updated dependencies [f262539]
- Updated dependencies [a01e917]
- Updated dependencies [3bb4e26]
- Updated dependencies [8bdc149]
- Updated dependencies [f73da5d]
- Updated dependencies [3810996]
- Updated dependencies [23a4dc2]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [81f9544]
- Updated dependencies [4604a06]
  - @shipfox/api-definitions-dto@6.0.0
  - @shipfox/api-integration-core-dto@6.0.0
  - @shipfox/api-projects@6.0.0
  - @shipfox/api-workflows-dto@6.0.0
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
- Updated dependencies [2875241]
- Updated dependencies [bb037af]
- Updated dependencies [fb70438]
  - @shipfox/api-integration-core-dto@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-definitions-dto@5.0.0
  - @shipfox/api-projects@5.0.0
  - @shipfox/api-triggers-dto@5.0.0
  - @shipfox/api-workflows@5.0.0
  - @shipfox/api-workflows-dto@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/expression@1.1.3
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-module@0.3.2
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-outbox@0.2.3
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-temporal@0.3.1
  - @shipfox/workflow-document@2.1.1

## 4.0.0

### Patch Changes

- Updated dependencies [bbba3b7]
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-projects@4.0.0
  - @shipfox/api-workflows@4.0.0
  - @shipfox/node-module@0.3.1
  - @shipfox/node-outbox@0.2.2

## 3.0.0

### Patch Changes

- 7a71e7d: Aligns published dependency ranges with the workspace catalog policy.
- 08fc93b: Adds prebuilt production Temporal workflow bundles to API packages and removes runtime workflow compilation.
- Updated dependencies [3976f8c]
- Updated dependencies [6b23868]
- Updated dependencies [7ce5c9e]
- Updated dependencies [c5ee18f]
- Updated dependencies [7a71e7d]
- Updated dependencies [08fc93b]
  - @shipfox/node-module@0.3.0
  - @shipfox/api-integration-core-dto@3.0.0
  - @shipfox/workflow-document@2.1.0
  - @shipfox/node-temporal@0.3.0
  - @shipfox/api-projects@3.0.0
  - @shipfox/api-workflows@3.0.0
  - @shipfox/expression@1.1.2
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
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-module@0.2.0
  - @shipfox/node-temporal@0.2.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-definitions-dto@2.0.0
  - @shipfox/api-integration-core-dto@2.0.0
  - @shipfox/api-projects@2.0.0
  - @shipfox/api-triggers-dto@2.0.0
  - @shipfox/api-workflows@2.0.0
  - @shipfox/api-workflows-dto@2.0.0
  - @shipfox/config@1.2.1
  - @shipfox/expression@1.1.1
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-outbox@0.2.1
  - @shipfox/node-postgres@0.4.1
  - @shipfox/workflow-document@2.0.1

## 0.1.2

### Patch Changes

- Updated dependencies [705dd43]
  - @shipfox/node-outbox@0.2.0
  - @shipfox/api-projects@0.1.2
  - @shipfox/api-workflows@0.1.2
  - @shipfox/node-module@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/api-projects@0.1.1
  - @shipfox/api-workflows@0.1.1
  - @shipfox/node-module@0.1.1
  - @shipfox/node-outbox@0.1.1

## 0.1.0

### Minor Changes

- a460020: Add trigger event detail decisions with stored subscription names, run links, and payload inspection.
- 5ec8367: Adds trigger event inspection endpoints with matching DTO schemas for listing received events and reading event decisions.

### Patch Changes

- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- 555299c: Add the append-only `triggers_received_events` and `triggers_decisions` tables that back the trigger event history. DB layer only: Drizzle schema, inferred types, and row→domain mappers, folded into the triggers module's baseline migration. No write or read path is wired yet.
- 9a4807d: Add the hourly Temporal prune cron and `TRIGGER_EVENT_RETENTION_DAYS` config var that bound trigger event history growth. The cron deletes `triggers_received_events` older than the retention window (default 30 days); `triggers_decisions` go with them via FK cascade.
- e5d2f13: Add the workspace **Events** page in Settings: a filterable, cursor-paginated table of
  trigger events (status dot, source/event, routing summary, delivery id, received time)
  mounted at `/workspaces/$wid/settings/events` and wired into the settings sub-nav. Filters
  (date range, source, event, outcome) live in the URL via `validateSearch`, so a filtered
  view is shareable. Source and event filters are populated by a new
  `GET /trigger-events/facets` endpoint that returns each workspace's distinct source/event
  values with counts (top 50, backed by `(workspace_id, source)` / `(workspace_id, event)`
  indexes); the list still renders if facets fail to load.
- a982f20: Stop a permanently-broken trigger subscription from starving its siblings or wedging the outbox. Integration dispatch now attempts every matched subscription and classifies each `runWorkflow` failure: a permanent error (deleted definition or project mismatch) is recorded and skipped, while a transient one re-throws so the outbox replays the event and converges. The event reaches a terminal outcome once no transient error remains (`routed` when any run was created, otherwise the new `errored` outcome), with a guarded write that never records `errored` over an event that already produced a run. The manual-fire path records the same terminal outcome, and `@shipfox/api-workflows` exports an `isPermanentRunWorkflowError` classifier. The trigger-events read API (`triggerEventOutcomeSchema`) accepts the new `errored` outcome for serialization and filtering.
- 3dcd751: Adds listener filter snapshots to job activation events and persists them on listener subscriptions.
- 6077301: Adds shared timestamp/id keyset pagination helpers and migrates workflow run and trigger event lists onto them.
- 3bea87f: Adds a typed `subscriberFactory` that binds each outbox event name to its payload type at construction, so subscriber handlers receive a typed `(payload, event)` and the per-handler `event.payload as X` casts are gone; a private brand makes the factory the only way to build a module subscriber.
- b74f635: Adds workflow run interpolation context resolution while preserving authored step configuration for reruns and diagnostics.
- e192d86: Adds the cron firing engine: a once-per-minute tick fans out bounded drain activities that claim due schedules (FOR UPDATE SKIP LOCKED), advance their next fire time, and fire the workflow deduplicated and crash-safe, recorded in trigger history with a `cron` origin and surfaced through cron fire and backlog metrics.
- 638ac4d: Adds cron trigger schedule persistence and deterministic next-fire computation for resolved workflow definitions.
- Updated dependencies [eb40964]
- Updated dependencies [7bc7498]
- Updated dependencies [5c18360]
- Updated dependencies [2c156d2]
- Updated dependencies [26fea4b]
- Updated dependencies [0cf66c4]
- Updated dependencies [34ba284]
- Updated dependencies [a56748d]
- Updated dependencies [8f51daf]
- Updated dependencies [5707d6d]
- Updated dependencies [e689abf]
- Updated dependencies [59ba68b]
- Updated dependencies [7a9943d]
- Updated dependencies [ce3e5ca]
- Updated dependencies [f788565]
- Updated dependencies [b9c3f32]
- Updated dependencies [c17dd6e]
- Updated dependencies [a81b68c]
- Updated dependencies [115655e]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [cdf8989]
- Updated dependencies [e47f8da]
- Updated dependencies [736249b]
- Updated dependencies [2bc5595]
- Updated dependencies [b1f57d1]
- Updated dependencies [1127ba2]
- Updated dependencies [36f871d]
- Updated dependencies [e7b01dd]
- Updated dependencies [d546b88]
- Updated dependencies [58c05ed]
- Updated dependencies [ce062a9]
- Updated dependencies [9086e65]
- Updated dependencies [7b175f5]
- Updated dependencies [7ca4c65]
- Updated dependencies [e9056c7]
- Updated dependencies [8e9c6cb]
- Updated dependencies [97162dd]
- Updated dependencies [b694b09]
- Updated dependencies [c47be09]
- Updated dependencies [f9f059e]
- Updated dependencies [940696a]
- Updated dependencies [f3614ae]
- Updated dependencies [f98c2be]
- Updated dependencies [e9396c9]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [f92122b]
- Updated dependencies [e250c4c]
- Updated dependencies [b525dcd]
- Updated dependencies [f8f339a]
- Updated dependencies [857fd73]
- Updated dependencies [e5d2f13]
- Updated dependencies [a982f20]
- Updated dependencies [7fa8f0b]
- Updated dependencies [998eba3]
- Updated dependencies [5327934]
- Updated dependencies [314e84e]
- Updated dependencies [a460020]
- Updated dependencies [3afb7e3]
- Updated dependencies [139e3be]
- Updated dependencies [eb7d5e8]
- Updated dependencies [247cbd6]
- Updated dependencies [5d53ed4]
- Updated dependencies [c652a68]
- Updated dependencies [121b42e]
- Updated dependencies [75520ff]
- Updated dependencies [e87731a]
- Updated dependencies [795f440]
- Updated dependencies [3dcd751]
- Updated dependencies [c0a883c]
- Updated dependencies [362b3eb]
- Updated dependencies [b8e49ff]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [f85b223]
- Updated dependencies [9c1c947]
- Updated dependencies [f0afdf8]
- Updated dependencies [9d3b43a]
- Updated dependencies [d635979]
- Updated dependencies [3bea87f]
- Updated dependencies [82d22e4]
- Updated dependencies [d69b164]
- Updated dependencies [69d02e5]
- Updated dependencies [2fb3e87]
- Updated dependencies [01be723]
- Updated dependencies [f63c6b0]
- Updated dependencies [e0fee57]
- Updated dependencies [b74f635]
- Updated dependencies [fa67aa3]
- Updated dependencies [e192d86]
- Updated dependencies [9a5aac4]
- Updated dependencies [30d1c82]
- Updated dependencies [5ec8367]
- Updated dependencies [ef1e917]
- Updated dependencies [51eb38a]
- Updated dependencies [61de795]
- Updated dependencies [c6eb2ee]
- Updated dependencies [e2fbef8]
- Updated dependencies [8ecba0f]
- Updated dependencies [f9153e8]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [2ad300c]
- Updated dependencies [a314b05]
- Updated dependencies [43fd0c1]
- Updated dependencies [950ebef]
- Updated dependencies [6181819]
- Updated dependencies [a8905ed]
- Updated dependencies [1ea2f6a]
- Updated dependencies [e699508]
- Updated dependencies [ad6056b]
- Updated dependencies [282e66a]
- Updated dependencies [0dd23a7]
- Updated dependencies [9c149d1]
- Updated dependencies [f88aac9]
- Updated dependencies [e1d4972]
- Updated dependencies [f9bf446]
- Updated dependencies [a856155]
- Updated dependencies [78527ce]
- Updated dependencies [b8919da]
- Updated dependencies [8ecc121]
- Updated dependencies [d7b9596]
  - @shipfox/workflow-document@2.0.0
  - @shipfox/api-workflows@0.1.0
  - @shipfox/api-workflows-dto@0.1.0
  - @shipfox/expression@1.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-definitions-dto@0.0.1
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-integration-core-dto@0.1.0
  - @shipfox/api-projects@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/api-triggers-dto@0.1.0
  - @shipfox/config@1.2.0
