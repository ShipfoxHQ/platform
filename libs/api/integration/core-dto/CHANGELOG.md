# @shipfox/api-integration-core-dto

## 14.0.0

### Major Changes

- 18e9bad: Adds source-control ref resolution that pins branch and tag names to commits.

### Minor Changes

- c44641f: Adds provider capabilities to the `integrations.connection.available` event, so subscribers can tell a tool connection from a source-control connection. The publisher now carries the capabilities the connection DTO already exposes.
- 1b71a66: Exposes each provider's event catalog and the fixed-event providers on the integration validation context. Every provider now refuses the reserved `manual` and `cron` connection slugs.

## 12.2.0

### Minor Changes

- 7901a60: Retry workspace workflow definition syncs when an integration connection becomes available.

## 12.0.0

### Major Changes

- 54c820e: Capture the actor that caused a source-control event on the normalized trigger reference. `TriggerReference` gains a required `actor`, resolved from the webhook sender by the GitHub and Gitea providers and null for payloads that name none.

### Minor Changes

- f13e8bb: Add Jira dynamic webhook registration and authenticated event ingestion through
  the shared stored-webhook workflow. Update the SPI webhook request exports and
  serialize Jira installation replacement across API replicas. Preserve Jira
  delivery identifiers and require lifecycle callbacks for registration. Remove
  the unused Jira webhook signing-secret configuration and allow HS256 verification
  at a supplied receipt time.
- 869a792: Refresh source-backed project repository identity from GitHub repository and installation-repository events.
- 032d316: Scope checkout credential minting to the currently running checkout step and return its fetch depth.
- cb0abfa: Expose the normalized trigger project, repository, ref, and commit in workflow context.

### Patch Changes

- Updated dependencies [f78740d]
  - @shipfox/inter-module@0.2.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/inter-module@0.2.2

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/inter-module@0.2.1

## 9.0.0

### Major Changes

- 02974d6: Removes executable policy and test fixtures from public API DTO roots.
- 4a6d124: Separates Integrations provider SPI contracts from the public DTO surface.

### Patch Changes

- @shipfox/inter-module@0.2.0

## 8.0.0

### Major Changes

- 7f227c6: Moves Projects and Integrations synchronous contracts to producer-owned inter-module entry points.

## 6.0.0

### Minor Changes

- 0bb82a4: Adds the Agent and Integrations inter-module APIs, moving Workflows agent configuration, runtime credential resolution, and integration consumers behind producer-owned clients.
- f262539: Adds a composed webhook processor and optional provider-neutral delivery source for hosted API runtimes.
- 3bb4e26: Fixes composed webhook processing and exposes Slack URL-verification responses through the shared contract.
- 4604a06: Adds the shared versioned inbound webhook request and processing contracts.

### Patch Changes

- Updated dependencies [81f9544]
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Minor Changes

- 2875241: Adds deduplicated Slack installation revocation for app uninstall and bot token-revocation events.
- fb70438: Cascades provider installation and token deletion when removing a connection.

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 3.0.0

### Minor Changes

- 6b23868: Adds provider event and GitHub agent-tool catalogs for generated integration reference documentation.

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 0.1.0

### Minor Changes

- 115655e: Moves source-event translation to the integration module: source-control providers emit a typed, provider-agnostic `INTEGRATION_SOURCE_COMMIT_PUSHED` event via one transactional publisher, projects subscribes to it instead of decoding GitHub payloads, and branch-deletion pushes are dropped at the source.
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

- ce062a9: Validates authored agent step integrations against provider tool catalogs and workspace connection capabilities.
- f3614ae: Add `createCheckoutSpec()` to the integration source-control service and the GitHub provider. GitHub mints a short-lived, repo-scoped installation access token and returns it as structured `CheckoutCredentials` alongside a clean `repositoryUrl`; the secret is never embedded in the URL. `ref` defaults to the repository default branch, providers without checkout support raise a typed `IntegrationCheckoutUnsupportedError`, and a `redactCheckoutSpec()` helper masks the token for logging. Dormant until the checkout-token endpoint and runner enrichment are wired in; no runtime behavior changes yet.
- f8f339a: Add the `@shipfox/redact` package with shared credential-redaction helpers: `redactUrlCredentials` (scheme-agnostic free-text scrubber), `stripUrlCredentials` (structured single-URL stripper), `redactSecrets` (literal-secret scrubber), and the `REDACTION_PLACEHOLDER` constant. Move `redactCheckoutSpec` from `@shipfox/api-integration-core-dto` into `@shipfox/api-integration-core` so it can reuse the shared `stripUrlCredentials` without breaking the dto-only-dependency rule; its public export path (`@shipfox/api-integration-core`) is unchanged. No behavior change.
- 01be723: Adds a shared GitHub installation token provider with broad REST minting, in-memory reuse, refresh-margin reminting, single-flight dedupe, and a missing-installation provider error reason.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
