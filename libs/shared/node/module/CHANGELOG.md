# @shipfox/node-module

## 1.0.9

### Patch Changes

- Updated dependencies [ba481d6]
  - @shipfox/node-fastify@0.4.4

## 1.0.8

### Patch Changes

- b416c4c: Preserves existing package behavior while simplifying internal control flow.
- Updated dependencies [b416c4c]
  - @shipfox/node-outbox@0.2.7
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-fastify@0.4.3
  - @shipfox/node-opentelemetry@0.6.5
  - @shipfox/node-temporal@0.4.6

## 1.0.7

### Patch Changes

- @shipfox/node-opentelemetry@0.6.5
- @shipfox/node-fastify@0.4.3
- @shipfox/node-temporal@0.4.6

## 1.0.6

### Patch Changes

- @shipfox/node-opentelemetry@0.6.4
- @shipfox/node-fastify@0.4.2
- @shipfox/node-temporal@0.4.5

## 1.0.5

### Patch Changes

- f78740d: Remove Unicode dash punctuation from package prose and source comments.
- Updated dependencies [f78740d]
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-fastify@0.4.1
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-outbox@0.2.6

## 1.0.4

### Patch Changes

- Updated dependencies [74f9e31]
  - @shipfox/node-fastify@0.4.0
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-temporal@0.4.4

## 1.0.3

### Patch Changes

- Updated dependencies [4425c6d]
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-fastify@0.3.4
  - @shipfox/node-temporal@0.4.4

## 1.0.2

### Patch Changes

- Updated dependencies [a831b32]
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-fastify@0.3.3
  - @shipfox/node-temporal@0.4.3

## 1.0.1

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-error-monitoring@0.2.2
  - @shipfox/node-fastify@0.3.2
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-temporal@0.4.2

## 1.0.0

### Major Changes

- 154e03f: Require every `ModuleDatabase` declaration to provide a stable database namespace and use it for the Drizzle migration-history table name.

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/inter-module@0.2.1
  - @shipfox/node-drizzle@0.3.3
  - @shipfox/node-error-monitoring@0.2.1
  - @shipfox/node-fastify@0.3.1
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-outbox@0.2.5
  - @shipfox/node-temporal@0.4.1

## 0.5.0

### Minor Changes

- ac42c96: Adds boundary-owned reporting for unexpected API runtime failures while preserving expected client and provider outcomes.
- 6ce08c0: Adds provider-neutral OpenTelemetry traces and Prometheus metrics across the API, Fastify, module workers, and Temporal workers.

### Patch Changes

- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-temporal@0.4.0
  - @shipfox/node-opentelemetry@0.6.0

## 0.4.0

### Minor Changes

- 54ce48b: Makes an empty outbox publisher registry fail dispatcher boot and logs registered publishers safely.
- c0162b0: Adds a bounded lifecycle for non-Temporal API module services.
- a01e917: Passes a per-initialization outbox registry through module startup, workers, and dispatch services instead of process-global state.
- 3810996: Adds dispatcher backlog metrics from registered pending outbox rows.
- 81f9544: Adds the registered in-memory inter-module transport: browser-safe contract primitives in `@shipfox/inter-module` (`defineInterModuleContract`, `defineInterModulePresentation`, known-error branding) and `@shipfox/node-module/inter-module` (`createInMemoryInterModuleTransport`, module integration, and a framework-neutral fake-presentation test harness). Extends the packed external-consumer check to cover the new package.

### Patch Changes

- Updated dependencies [f4bc2eb]
- Updated dependencies [7ac43a4]
- Updated dependencies [8aa7cd3]
- Updated dependencies [81f9544]
  - @shipfox/node-temporal@0.3.2
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-outbox@0.2.4
  - @shipfox/node-fastify@0.2.4
  - @shipfox/inter-module@0.2.0

## 0.3.2

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-outbox@0.2.3
  - @shipfox/node-temporal@0.3.1

## 0.3.1

### Patch Changes

- Updated dependencies [bbba3b7]
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/node-outbox@0.2.2

## 0.3.0

### Minor Changes

- 3976f8c: Adds module login-method declarations, validates server compositions before startup, and adds password-login route configuration.

### Patch Changes

- Updated dependencies [c5ee18f]
- Updated dependencies [7a71e7d]
- Updated dependencies [08fc93b]
  - @shipfox/node-temporal@0.3.0
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/node-fastify@0.2.2

## 0.2.0

### Minor Changes

- 0cd6dd4: Adds stoppable module workers and declarative module startup tasks for server composition.
- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [a68458a]
- Updated dependencies [6eba800]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-temporal@0.2.0
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-outbox@0.2.1

## 0.1.2

### Patch Changes

- Updated dependencies [705dd43]
  - @shipfox/node-outbox@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-outbox@0.1.1

## 0.1.0

### Minor Changes

- d6d4862: Add a Sentry integration provider that ingests issue webhooks.
  - New `@shipfox/api-integration-sentry` + `-sentry-dto` packages: a webhook
    receiver that verifies the HMAC-SHA256 signature (keyed with the app client
    secret), dedups on `Request-ID`, normalizes the issue payload, and publishes
    `integrations.event.received` with `source: 'sentry'` and `event:
issue.<action>`. A raw `ignored` action is normalized to `archived`. Malformed,
    bad-JSON, unknown-action, and unknown-resource deliveries are recorded-and-dropped
    with a 204 (deliberate deviation from GitHub's 400 to avoid Sentry disabling the
    webhook).
  - `@shipfox/api-integration-core-dto`: add the `SentryIssuePayload` contract.
  - `@shipfox/api-integration-core`: register the Sentry provider behind
    `INTEGRATIONS_ENABLE_SENTRY_PROVIDER`, add the
    `updateIntegrationConnectionLifecycleStatus` helper, and pin stable
    migration-tracking table names per provider database.
  - `@shipfox/node-fastify`: add the shared `rawBodyPlugin` and `WEBHOOK_BODY_LIMIT`
    exports for webhook receivers.
  - `@shipfox/node-module`: add an optional `migrationsTableName` to `ModuleDatabase`
    so conditionally-composed databases get a position-independent migration table.
  - `@shipfox/api-integration-github`: consume the shared `rawBodyPlugin` instead of
    a local copy (internal refactor, no behavior change).

  Deploy note: environments with GitHub enabled must rename the existing
  `__drizzle_migrations_integrations_1` table to
  `__drizzle_migrations_integrations_github` as part of this release, or GitHub
  migrations re-run against existing tables.

- 3bea87f: Adds a typed `subscriberFactory` that binds each outbox event name to its payload type at construction, so subscriber handlers receive a typed `(payload, event)` and the per-handler `event.payload as X` casts are gone; a private brand makes the factory the only way to build a module subscriber.
- 9c149d1: Adds an app-owned runtime worker failure callback and fail-fast worker startup errors so API services can treat module-declared Temporal workers as process health dependencies.

### Patch Changes

- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- 75520ff: Add the foundation for metrics observability. `@shipfox/node-module` gains an optional `metrics` hook on `ShipfoxModule` plus `registerModuleMetrics`, a declarative slot for modules to register service-level metrics (observable gauges) once at app startup, kept separate from `initializeModules` so unit tests never bind the metrics port. `@shipfox/api-runners` is instrumented as the worked example across both planes: instance counters for job enqueue, claim, and lease expiry recorded inline, and `runners_pending_jobs` / `runners_running_jobs` observable gauges over a new `getJobQueueDepth` query wired through the module hook.
- Updated dependencies [34ba284]
- Updated dependencies [5707d6d]
- Updated dependencies [b9c3f32]
- Updated dependencies [e47f8da]
- Updated dependencies [7b175f5]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [f92122b]
- Updated dependencies [857fd73]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
  - @shipfox/node-fastify@0.2.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-outbox@0.1.0
