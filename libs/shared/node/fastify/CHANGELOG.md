# @shipfox/node-fastify

## 0.4.3

### Patch Changes

- @shipfox/node-opentelemetry@0.6.5

## 0.4.2

### Patch Changes

- @shipfox/node-opentelemetry@0.6.4

## 0.4.1

### Patch Changes

- f78740d: Remove Unicode dash punctuation from package prose and source comments.

## 0.4.0

### Minor Changes

- 74f9e31: Support validated wildcard subdomain origins in the shared Fastify CORS boundary.

### Patch Changes

- @shipfox/config@1.2.4
- @shipfox/node-error-monitoring@0.3.0
- @shipfox/node-opentelemetry@0.6.3

## 0.3.4

### Patch Changes

- Updated dependencies [4425c6d]
  - @shipfox/node-opentelemetry@0.6.3

## 0.3.3

### Patch Changes

- Updated dependencies [a831b32]
  - @shipfox/node-error-monitoring@0.3.0

## 0.3.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/config@1.2.4
  - @shipfox/node-error-monitoring@0.2.2
  - @shipfox/node-opentelemetry@0.6.2

## 0.3.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/config@1.2.3
  - @shipfox/node-error-monitoring@0.2.1
  - @shipfox/node-opentelemetry@0.6.1

## 0.3.0

### Minor Changes

- 6ce08c0: Adds provider-neutral OpenTelemetry traces and Prometheus metrics across the API, Fastify, module workers, and Temporal workers.

### Patch Changes

- ac42c96: Adds boundary-owned reporting for unexpected API runtime failures while preserving expected client and provider outcomes.
- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-opentelemetry@0.6.0

## 0.2.4

### Patch Changes

- 8aa7cd3: Adds a shared Linear webhook processor that preserves raw-body signatures and receipt-time replay validation.

## 0.2.3

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/config@1.2.2
  - @shipfox/node-error-monitoring@0.1.3
  - @shipfox/node-opentelemetry@0.5.2

## 0.2.2

### Patch Changes

- Updated dependencies [7a71e7d]
  - @shipfox/node-opentelemetry@0.5.1

## 0.2.1

### Patch Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/config@1.2.1
  - @shipfox/node-error-monitoring@0.1.2
  - @shipfox/node-opentelemetry@0.5.0

## 0.2.0

### Minor Changes

- 34ba284: Adds route preHandler support so module routes can run typed request hooks after schema validation.
- b9c3f32: Adds optional host and port overrides to the Fastify listener for app-owned server configuration.
- f92122b: Adds the logs module foundation: a stateless monolith module with its own schema, the runner-facing offset-CAS append endpoint (job-lease authenticated, idempotent, multi-instance safe), a per-job accrual budget with a cap tombstone, and an S3-compatible client targeting Garage at startup. The NDJSON v1 record contract lives in the new `@shipfox/api-logs-dto` package, and `@shipfox/node-fastify` gains a `createRawBodyPlugin({contentType, bodyLimit})` factory for byte-exact request bodies.
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

- c0a883c: Adds an `extractBearerToken` helper next to the auth method registry so every auth adapter shares one Authorization-header parser.

### Patch Changes

- e47f8da: Documents every environment-variable config param with a `desc` field so self-hosters can see what each variable does and how to set it.
- 857fd73: Receive Gitea push webhooks and trigger runs through the existing source-push pipeline.
  - `@shipfox/api-integration-gitea-dto`: `giteaPushPayloadSchema` (`{ref, after, repository: {name, full_name, default_branch, owner: {username}}}`).
  - `@shipfox/api-integration-gitea`: `POST /webhooks/integrations/gitea` (`auth: []`, `rawBodyPlugin`, standard webhook body limit). It verifies the `X-Gitea-Signature` header as hex HMAC-SHA256 of the raw body keyed by `GITEA_WEBHOOK_SECRET` (401 on mismatch), records non-`push` events for delivery dedup and returns 204, and on a `push` resolves the org (`repository.owner.username`, lower-cased to match the stored org) to its connection, drops branch deletions and unknown orgs, and publishes a normalized `SourcePushPayload` (`externalRepositoryId: gitea:<owner>/<repo>` built from `owner.username`/`repository.name` to match the source-control adapter, `refs/heads/` stripped, `headCommitSha: after`, `isDefaultBranch`). `getGiteaConnectionByOrg` gains an optional transaction executor so the lookup runs inside the publishing transaction. The webhook is registered out of band by the Gitea instance admin, so the connect flow registers nothing.
  - `@shipfox/api-integration-core`: wire `publishSourcePush`, `recordDeliveryOnly`, `getIntegrationConnectionById`, and the core database into the Gitea provider, mirroring GitHub.
  - `@shipfox/node-fastify`: add a shared `verifyHexHmacSignature` helper for hex HMAC-SHA256 webhook signatures.
  - `@shipfox/api-integration-sentry`: `verifySentrySignature` now delegates to the shared helper.

  A push to a connected org's repo creates a workflow run through the existing pipeline. Duplicate POSTs of the same delivery are deduped via `X-Gitea-Delivery`; note that a manual "Redeliver" in Gitea mints a new delivery id and intentionally produces a fresh run (unlike GitHub, whose redelivery reuses the original id and is suppressed).

- Updated dependencies [e47f8da]
- Updated dependencies [7b175f5]
  - @shipfox/node-error-monitoring@0.1.1
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/config@1.2.0
