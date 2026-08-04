# @shipfox/api-integration-sentry-dto

## 12.0.0

### Patch Changes

- f78740d: Remove Unicode dash punctuation from package prose and source comments.
- Updated dependencies [f13e8bb]
- Updated dependencies [869a792]
- Updated dependencies [032d316]
- Updated dependencies [54c820e]
- Updated dependencies [cb0abfa]
  - @shipfox/api-integration-core-dto@12.0.0

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-integration-core-dto@9.0.2

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/api-integration-core-dto@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [02974d6]
- Updated dependencies [4a6d124]
  - @shipfox/api-integration-core-dto@9.0.0

## 8.0.0

### Patch Changes

- Updated dependencies [7f227c6]
  - @shipfox/api-integration-core-dto@8.0.0

## 6.0.0

### Patch Changes

- Updated dependencies [0bb82a4]
- Updated dependencies [f262539]
- Updated dependencies [3bb4e26]
- Updated dependencies [4604a06]
  - @shipfox/api-integration-core-dto@6.0.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [2875241]
- Updated dependencies [bb037af]
- Updated dependencies [fb70438]
  - @shipfox/api-integration-core-dto@5.0.0

## 3.0.0

### Minor Changes

- 6b23868: Adds provider event and GitHub agent-tool catalogs for generated integration reference documentation.

### Patch Changes

- 60e7bf5: Clarifies that ignored Sentry issue webhooks produce archived integration events.
- Updated dependencies [6b23868]
  - @shipfox/api-integration-core-dto@3.0.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-integration-core-dto@2.0.0

## 0.1.0

### Minor Changes

- d245be8: [api/integrations] Make the signed Sentry installation webhook authoritative.
  - `@shipfox/api-integration-sentry-dto`: reshape `sentryInstallationWebhookSchema`
    to read `data.installation.{uuid, organization.slug, status, code}` plus an
    optional top-level `actor`. Only consumed fields are validated and the raw
    `code` is never logged.
  - `@shipfox/api-integration-sentry`: the signed `installation.created` webhook now
    exchanges the single-use code and persists a verified-but-unclaimed installation
    (`connection_id IS NULL`, `code_hash = sha256(code)`). The browser flow narrows
    to a claim that binds a verified install to a workspace under unified claim auth
    (exchange-success, same-code hash match, or a retryable
    `verification-in-progress` while a concurrent webhook is mid-exchange), with a
    proof-mismatch 403 closing the bare-uuid IDOR. The exchange/verify run outside
    the DB transaction; a short transaction wraps persist + delivery record. Adds
    `connection_id` nullable + `code_hash` to the installations table and a daily TTL
    cron that tombstones never-claimed installs.
  - `@shipfox/api-integration-core`: inject the Sentry client into the webhook
    context, resolve a null `connection_id` to "no connection" for pre-claim issue
    deliveries, and register the unclaimed-installation cleanup cron when Sentry is
    enabled.
  - `@shipfox/client-integrations`: treat the retryable `verification-in-progress`
    response as a backoff-eligible failure on the connect callback.

- 5b8ed32: Add the Sentry install/connect flow so a workspace member can link a Sentry
  installation to a Shipfox workspace, writing the connection + installation rows
  that the webhook receiver looks up.
  - `@shipfox/api-integration-sentry`: add a stateless `SentryApiClient`
    (authorization-code exchange, org-slug derivation, optional verify-install),
    `handleSentryConnect`, and two authenticated routes —
    `POST /integrations/sentry/install` (returns the external-install URL) and
    `POST /integrations/sentry/connect` (links the installation). Sentry has no
    `state` param, so the workspace is taken from the request body and authorized
    against the live session; the org slug is derived from Sentry, never trusted
    from the body. The verify-install side effect runs after the row is persisted,
    and no Sentry token is stored. Provider HTTP errors map to a typed
    `SentryIntegrationProviderError` and never carry the token, code, or client
    secret.
  - `@shipfox/api-integration-sentry-dto`: add the install/connect request and
    response schemas.
  - `@shipfox/api-integration-core`: wire the `getExistingSentryConnection` and
    `connectSentryInstallation` closures into the Sentry provider (internal
    wiring, no public API change).

  A concurrent same-install connect race (shared with GitHub) is tracked
  separately in ENG-409.

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

### Patch Changes

- Updated dependencies [115655e]
- Updated dependencies [ce062a9]
- Updated dependencies [f3614ae]
- Updated dependencies [f8f339a]
- Updated dependencies [b8e49ff]
- Updated dependencies [d6d4862]
- Updated dependencies [01be723]
- Updated dependencies [2933c33]
  - @shipfox/api-integration-core-dto@0.1.0
