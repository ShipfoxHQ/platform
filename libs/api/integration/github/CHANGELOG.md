# @shipfox/api-integration-github

## 13.1.0

### Minor Changes

- 7ae5396: Attributes new runner commits to the GitHub App bot account. Existing runner workspaces keep their first configured author until recreated. Update downstream author filters that match the previous App ID email address.

## 12.7.0

### Minor Changes

- 4639dd9: Add GitHub pull request review-thread inspection and resolution tools.

## 12.6.0

### Patch Changes

- 8aaed9e: Expose bounded error codes for deterministic GitHub agent tool failures.
- 4848ad7: Fix pending GitHub review comments by resolving the caller's pending review through the REST API.
- 594cdbe: Support both stateless and stateful GitHub App installation token formats.

## 12.5.0

### Patch Changes

- 420ef97: GitHub agent artifact downloads now use GitHub's required zip format and return a temporary download URL.
- f2b20af: Preserve GitHub provider rejection details and classify terminal agent-tool failures without reporting them as provider outages.
- da02bd8: Add comments to the caller's latest pending pull request review.
- 4fa3667: Resolve the latest pending pull request review before submitting or deleting it.
- Updated dependencies [f2b20af]
  - @shipfox/api-integration-spi@1.1.1

## 12.3.0

### Patch Changes

- Updated dependencies [e0110fe]
  - @shipfox/api-integration-spi@1.1.0

## 12.2.0

### Patch Changes

- @shipfox/api-integration-github-dto@12.2.0
- @shipfox/api-integration-spi@1.0.1
- @shipfox/node-opentelemetry@0.6.4
- @shipfox/node-fastify@0.4.2
- @shipfox/api-auth-context@12.2.0

## 12.0.0

### Minor Changes

- 54c820e: Capture the actor that caused a source-control event on the normalized trigger reference. `TriggerReference` gains a required `actor`, resolved from the webhook sender by the GitHub and Gitea providers and null for payloads that name none.

### Patch Changes

- f78740d: Remove Unicode dash punctuation from package prose and source comments.
- 9dffe58: Drop pull request webhook deliveries opened from a fork before they can trigger a run.
- 24ef475: Adds provider-normalized repository, ref, and commit extraction for source-control trigger payloads.
- 869a792: Refresh source-backed project repository identity from GitHub repository and installation-repository events.
- Updated dependencies [f78740d]
- Updated dependencies [24ef475]
- Updated dependencies [f13e8bb]
- Updated dependencies [869a792]
- Updated dependencies [54c820e]
  - @shipfox/node-fastify@0.4.1
  - @shipfox/api-integration-spi@1.0.0
  - @shipfox/node-postgres@0.5.0
  - @shipfox/api-integration-github-dto@12.0.0
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/node-drizzle@0.3.5

## 11.0.0

### Patch Changes

- Updated dependencies [25158c8]
  - @shipfox/api-auth-context@11.0.0

## 10.2.0

### Patch Changes

- @shipfox/api-auth-context@10.2.0

## 10.1.0

### Patch Changes

- @shipfox/api-auth-context@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [74f9e31]
  - @shipfox/node-fastify@0.4.0
  - @shipfox/api-auth-context@10.0.0
  - @shipfox/api-integration-github-dto@9.0.2
  - @shipfox/api-integration-spi@0.2.2
  - @shipfox/config@1.2.4
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-postgres@0.4.4

## 9.3.0

### Patch Changes

- Updated dependencies [4425c6d]
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/api-auth-context@9.3.0
  - @shipfox/node-fastify@0.3.4

## 9.2.0

### Patch Changes

- @shipfox/api-auth-context@9.2.0

## 9.0.3

### Patch Changes

- Updated dependencies [a831b32]
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-fastify@0.3.3
  - @shipfox/api-auth-context@9.0.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-auth-context@9.0.2
  - @shipfox/api-integration-github-dto@9.0.2
  - @shipfox/api-integration-spi@0.2.2
  - @shipfox/config@1.2.4
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-error-monitoring@0.2.2
  - @shipfox/node-fastify@0.3.2
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/node-postgres@0.4.4

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/api-integration-github-dto@9.0.1
  - @shipfox/api-integration-spi@0.2.1
  - @shipfox/config@1.2.3
  - @shipfox/node-drizzle@0.3.3
  - @shipfox/node-error-monitoring@0.2.1
  - @shipfox/node-fastify@0.3.1
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-postgres@0.4.3

## 9.0.0

### Minor Changes

- 02974d6: Removes executable policy and test fixtures from public API DTO roots.

### Patch Changes

- 4a6d124: Separates Integrations provider SPI contracts from the public DTO surface.
- Updated dependencies [02974d6]
- Updated dependencies [4a6d124]
  - @shipfox/api-integration-github-dto@9.0.0
  - @shipfox/api-integration-spi@0.2.0
  - @shipfox/api-auth-context@9.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-postgres@0.4.2

## 8.0.0

### Patch Changes

- Updated dependencies [7f227c6]
  - @shipfox/api-integration-core-dto@8.0.0
  - @shipfox/api-integration-github-dto@8.0.0

## 7.1.0

### Patch Changes

- ac42c96: Adds boundary-owned reporting for unexpected API runtime failures while preserving expected client and provider outcomes.
- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/api-auth-context@7.1.0
  - @shipfox/api-workspaces@7.1.0

## 7.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/api-workspaces@7.0.1

## 7.0.0

### Patch Changes

- @shipfox/api-workspaces@7.0.0

## 6.0.0

### Minor Changes

- f262539: Adds a composed webhook processor and optional provider-neutral delivery source for hosted API runtimes.
- a869cfd: Adds shared stored-request processors for GitHub and Gitea webhook reception.

### Patch Changes

- 3bb4e26: Fixes composed webhook processing and exposes Slack URL-verification responses through the shared contract.
- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- 0649d62: Keeps GitHub credential cleanup and Sentry installation lifecycle handling safe across duplicate, concurrent, and reordered webhook delivery.
- 326f4c0: Exposes Workspaces inter-module operations and moves Auth and OAuth providers onto injected clients.
- Updated dependencies [0bb82a4]
- Updated dependencies [7366f04]
- Updated dependencies [7ac43a4]
- Updated dependencies [f262539]
- Updated dependencies [3bb4e26]
- Updated dependencies [c2db8c3]
- Updated dependencies [8bdc149]
- Updated dependencies [f73da5d]
- Updated dependencies [6bdf24b]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [326f4c0]
- Updated dependencies [1820feb]
- Updated dependencies [4604a06]
  - @shipfox/api-integration-core-dto@6.0.0
  - @shipfox/api-workspaces@6.0.0
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/api-auth-context@6.0.0
  - @shipfox/node-fastify@0.2.4
  - @shipfox/api-integration-github-dto@6.0.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [2875241]
- Updated dependencies [bb037af]
- Updated dependencies [fb70438]
  - @shipfox/api-integration-core-dto@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-integration-github-dto@5.0.0
  - @shipfox/api-workspaces@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-postgres@0.4.2

## 4.0.0

### Patch Changes

- Updated dependencies [bbba3b7]
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-workspaces@4.0.0

## 3.0.0

### Patch Changes

- 6b23868: Adds provider event and GitHub agent-tool catalogs for generated integration reference documentation.
- Updated dependencies [6b23868]
- Updated dependencies [7a71e7d]
  - @shipfox/api-integration-core-dto@3.0.0
  - @shipfox/api-integration-github-dto@3.0.0
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/api-workspaces@3.0.0
  - @shipfox/node-fastify@0.2.2
  - @shipfox/api-auth-context@3.0.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [c31a7e0]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/api-workspaces@2.0.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-integration-core-dto@2.0.0
  - @shipfox/api-integration-github-dto@2.0.0
  - @shipfox/config@1.2.1
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-postgres@0.4.1

## 0.1.2

### Patch Changes

- @shipfox/api-workspaces@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/api-workspaces@0.1.1

## 0.1.0

### Minor Changes

- b8e49ff: Add the client-side Sentry install/connect flow and a workspace settings
  integrations hub.
  - `@shipfox/client-integrations`: shared `IntegrationGallerySection` (capability
    filter, lifecycle pills, "Added" date, external link, connected-first
    ordering, degraded status mode), shared `RedirectInstallPage` powering the
    GitHub and new Sentry install pages, `SentryCallbackPage` with an explicit
    workspace confirm (sessionStorage only pre-selects), two-tier retry, and the
    Sentry hooks (`useCreateSentryInstallMutation`, `connectSentry`,
    `useIntegrationConnectionsQuery`).
  - `@shipfox/client-workspace-settings`: new `/workspaces/$wid/settings/integrations`
    page and an Integrations entry in the settings nav.
  - `@shipfox/client-router`: routes for the Sentry install page, the root-level
    Sentry callback, and the settings integrations page.
  - `@shipfox/react-ui`: `sentry` icon (monochrome, theme-aware).
  - `@shipfox/api-integration-core-dto`: optional `external_url` on the connection
    DTO and an optional `connectionExternalUrl` method on `IntegrationProvider`.
  - `@shipfox/api-integration-core`: `GET /integration-connections` now returns
    connections of every lifecycle status (the active-only filter prevented
    clients from surfacing disabled/error state) and resolves `external_url`
    per connection best-effort.
  - `@shipfox/api-integration-sentry` / `@shipfox/api-integration-github`:
    implement `connectionExternalUrl` (Sentry org URL via a new
    by-connection-id installation lookup; GitHub installation settings URL).

### Patch Changes

- 115655e: Moves source-event translation to the integration module: source-control providers emit a typed, provider-agnostic `INTEGRATION_SOURCE_COMMIT_PUSHED` event via one transactional publisher, projects subscribes to it instead of decoding GitHub payloads, and branch-deletion pushes are dropped at the source.
- ce062a9: Validates authored agent step integrations against provider tool catalogs and workspace connection capabilities.
- f3614ae: Add `createCheckoutSpec()` to the integration source-control service and the GitHub provider. GitHub mints a short-lived, repo-scoped installation access token and returns it as structured `CheckoutCredentials` alongside a clean `repositoryUrl`; the secret is never embedded in the URL. `ref` defaults to the repository default branch, providers without checkout support raise a typed `IntegrationCheckoutUnsupportedError`, and a `redactCheckoutSpec()` helper masks the token for logging. Dormant until the checkout-token endpoint and runner enrichment are wired in; no runtime behavior changes yet.
- 9f1c0ef: Harden integration connect against a concurrent same-install race. The installation upsert now only (re)points an installation at the connection that already owns it: the `onConflictDoUpdate` carries a `setWhere(connection_id = this connection)` predicate and throws `*InstallationAlreadyLinkedError` when the conflicting row belongs to a different connection. Two concurrent connects of the same provider install to different workspaces no longer leave one workspace with an active orphan connection while the install's webhooks silently route to the other; the losing transaction rolls back and surfaces a 409.
- 0667cce: Skip publishing source pushes for non-active integration connections. Both the GitHub and Gitea push webhook handlers now treat a connection whose `lifecycleStatus` is not `active` (disabled/error) like an unknown one: the delivery is recorded for dedup but no source-push event is published, so a disabled connection no longer triggers workflow runs.
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

- 82d22e4: Make the workspace-membership gate stateless. `requireWorkspaceAccess` now lives in `@shipfox/api-auth-context` and authorizes a request purely from the verified session-token claims, replacing the `requireMembership` gate in `@shipfox/api-workspaces` that read the workspace row from the database on every workspace-scoped request. Membership and role already travel in the token, so the check needs no database access.

  This removes the per-request database read and severs the runtime dependency on `@shipfox/api-workspaces` from feature modules that only needed the membership gate (integration providers, secrets, projects, agent, runners). Workspace existence and `active`-status enforcement, which no code path currently exercises, moves off the hot path; enforce it at token issuance when workspace suspension is introduced.

- 01be723: Adds a shared GitHub installation token provider with broad REST minting, in-memory reuse, refresh-margin reminting, single-flight dedupe, and a missing-installation provider error reason.
- Updated dependencies [34ba284]
- Updated dependencies [5707d6d]
- Updated dependencies [b9c3f32]
- Updated dependencies [d02c5fd]
- Updated dependencies [a81b68c]
- Updated dependencies [115655e]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [ce062a9]
- Updated dependencies [7b175f5]
- Updated dependencies [f3614ae]
- Updated dependencies [f92122b]
- Updated dependencies [f8f339a]
- Updated dependencies [857fd73]
- Updated dependencies [b8e49ff]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [82d22e4]
- Updated dependencies [01be723]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [6181819]
  - @shipfox/node-fastify@0.2.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-workspaces@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-integration-core-dto@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/api-integration-github-dto@0.0.1
  - @shipfox/config@1.2.0
