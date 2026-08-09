# @shipfox/api-integration-gitea

## 12.5.0

### Patch Changes

- Updated dependencies [f2b20af]
  - @shipfox/api-integration-spi@1.1.1

## 12.3.0

### Patch Changes

- Updated dependencies [e0110fe]
  - @shipfox/api-integration-spi@1.1.0

## 12.2.0

### Patch Changes

- @shipfox/api-integration-gitea-dto@12.2.0
- @shipfox/api-integration-spi@1.0.1
- @shipfox/node-opentelemetry@0.6.4
- @shipfox/node-fastify@0.4.2
- @shipfox/api-auth-context@12.2.0

## 12.0.0

### Minor Changes

- 54c820e: Capture the actor that caused a source-control event on the normalized trigger reference. `TriggerReference` gains a required `actor`, resolved from the webhook sender by the GitHub and Gitea providers and null for payloads that name none.

### Patch Changes

- 24ef475: Adds provider-normalized repository, ref, and commit extraction for source-control trigger payloads.
- Updated dependencies [f78740d]
- Updated dependencies [24ef475]
- Updated dependencies [f13e8bb]
- Updated dependencies [869a792]
- Updated dependencies [54c820e]
  - @shipfox/node-fastify@0.4.1
  - @shipfox/api-integration-spi@1.0.0
  - @shipfox/node-postgres@0.5.0
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/api-integration-gitea-dto@12.0.0
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
  - @shipfox/api-integration-gitea-dto@9.0.2
  - @shipfox/api-integration-spi@0.2.2
  - @shipfox/config@1.2.4
  - @shipfox/node-drizzle@0.3.4
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

- @shipfox/node-fastify@0.3.3
- @shipfox/api-auth-context@9.0.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-auth-context@9.0.2
  - @shipfox/api-integration-gitea-dto@9.0.2
  - @shipfox/api-integration-spi@0.2.2
  - @shipfox/config@1.2.4
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-fastify@0.3.2
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/node-postgres@0.4.4

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/api-integration-gitea-dto@9.0.1
  - @shipfox/api-integration-spi@0.2.1
  - @shipfox/config@1.2.3
  - @shipfox/node-drizzle@0.3.3
  - @shipfox/node-fastify@0.3.1
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-postgres@0.4.3

## 9.0.0

### Patch Changes

- 4a6d124: Separates Integrations provider SPI contracts from the public DTO surface.
- Updated dependencies [4a6d124]
  - @shipfox/api-integration-spi@0.2.0
  - @shipfox/api-auth-context@9.0.0
  - @shipfox/api-integration-gitea-dto@9.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-postgres@0.4.2

## 8.0.0

### Patch Changes

- Updated dependencies [7f227c6]
  - @shipfox/api-integration-core-dto@8.0.0
  - @shipfox/api-integration-gitea-dto@8.0.0

## 7.1.0

### Patch Changes

- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/api-auth-context@7.1.0

## 6.0.0

### Minor Changes

- f262539: Adds a composed webhook processor and optional provider-neutral delivery source for hosted API runtimes.
- a869cfd: Adds shared stored-request processors for GitHub and Gitea webhook reception.

### Patch Changes

- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- Updated dependencies [0bb82a4]
- Updated dependencies [7ac43a4]
- Updated dependencies [f262539]
- Updated dependencies [3bb4e26]
- Updated dependencies [8bdc149]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [4604a06]
  - @shipfox/api-integration-core-dto@6.0.0
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/api-auth-context@6.0.0
  - @shipfox/node-fastify@0.2.4
  - @shipfox/api-integration-gitea-dto@6.0.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [2875241]
- Updated dependencies [bb037af]
- Updated dependencies [fb70438]
  - @shipfox/api-integration-core-dto@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-integration-gitea-dto@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-postgres@0.4.2

## 4.0.0

### Patch Changes

- Updated dependencies [bbba3b7]
  - @shipfox/node-drizzle@0.3.0

## 3.0.0

### Patch Changes

- Updated dependencies [6b23868]
- Updated dependencies [7a71e7d]
  - @shipfox/api-integration-core-dto@3.0.0
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/api-integration-gitea-dto@3.0.0
  - @shipfox/node-fastify@0.2.2
  - @shipfox/api-auth-context@3.0.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-integration-core-dto@2.0.0
  - @shipfox/api-integration-gitea-dto@2.0.0
  - @shipfox/config@1.2.1
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-postgres@0.4.1

## 0.0.2

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-postgres@0.4.0

## 0.0.1

### Patch Changes

- 58f51bd: Scaffold an empty `gitea` integration provider that mirrors the `github` package structure, ahead of any behavior.
  - New `@shipfox/api-integration-gitea` + `@shipfox/api-integration-gitea-dto` packages: `createGiteaIntegrationProvider()` returns an empty provider (`{provider: 'gitea', displayName: 'Gitea', adapters: {}, routes: []}`), plus a `src/config.ts` documenting the self-hoster variables (`GITEA_BASE_URL`, `GITEA_SERVICE_USERNAME`, `GITEA_SERVICE_TOKEN`, `GITEA_WEBHOOK_SECRET`, `GITEA_WEBHOOK_TARGET_URL`, `GITEA_CHECKOUT_TTL_SECONDS`) and an empty provider database wired with the stable migrations table `__drizzle_migrations_integrations_gitea`.
  - `@shipfox/api-integration-core`: register the Gitea provider behind `INTEGRATIONS_ENABLE_GITEA_PROVIDER` (default false). With the flag enabled, `gitea` appears in `GET /integration-providers`. Dormant scaffold; no runtime behavior yet.

- 75f2cc8: Implement the Gitea API client and source-control adapter so the `gitea` provider can read repositories and mint checkout credentials.
  - `GiteaApiClient`: calls `GITEA_BASE_URL` with service-account Basic auth to list org repositories, get a repository, resolve a ref to a commit sha, list a recursive tree, and read base64 file content, under a bounded request timeout. Gitea failures map to a `GiteaIntegrationProviderError` carrying a `reason` (`access-denied`, `repository-not-found`, `file-not-found`, `rate-limited` with `retryAfterSeconds`, `content-too-large`, `malformed-provider-response`, `timeout`, `provider-unavailable`).
  - `GiteaSourceControlProvider`: implements all five `SourceControlProvider` methods over the `gitea:<owner>/<repo>` external id scheme, scoping every request to the connection's own account because the service token is instance-wide. `listFiles` filters the tree by prefix and rejects a truncated tree as `too-many-files`; `fetchFile` enforces `MAX_REPOSITORY_FILE_BYTES`; `createCheckoutSpec` returns the repository's credential-free clone URL with service credentials carried separately.
  - `createGiteaIntegrationProvider()` now exposes the adapter at `adapters.source_control`.

- 570ac69: Add the Gitea connection flow so a workspace member can link a Gitea org with a single authenticated request (no OAuth, no redirect).
  - `@shipfox/api-integration-gitea-dto`: `createGiteaConnectionBodySchema` (`{workspace_id, org}`); the response reuses the shared `integrationConnectionDtoSchema`.
  - `@shipfox/api-integration-gitea`: `POST /integrations/gitea/connections` (`AUTH_USER`, workspace membership) canonicalizes the org to lower case (Gitea routes org names case-insensitively, so this keeps the case-sensitive ownership lookup and unique indexes from being bypassed by a case variant), validates the org via the API, rejects an org already linked to another workspace (409), registers an org-level push webhook (`POST /orgs/{org}/hooks` with `GITEA_WEBHOOK_SECRET`/`GITEA_WEBHOOK_TARGET_URL`), and in one transaction upserts the core connection (`provider: 'gitea'`, `externalAccountId: org`) and a new `integrations_gitea_connections` row (`connection_id`/`org` unique, stored `webhook_id`). Re-connecting an already-active org is idempotent and skips a second webhook. Webhook registration itself is idempotent (an existing org hook for the target URL is reused) and compensated (a hook created before a transaction that then rolls back is deleted), so concurrent or retried connects do not leave orphaned hooks. The `GiteaApiClient` gains `organizationExists`, `createOrgPushWebhook`, and `deleteOrgWebhook`, and the provider exposes `connectionExternalUrl` pointing at the org on the Gitea instance.
  - `@shipfox/api-integration-core`: wire the Gitea connect closure (`connectGiteaConnection`) and the cross-tenant lookup (`getExistingGiteaConnection`) into the provider, mirroring `connectGithubInstallation`.

  Connecting an org creates an active connection visible in `GET /integration-connections` and registers a Gitea webhook whose id is stored.

- 857fd73: Receive Gitea push webhooks and trigger runs through the existing source-push pipeline.
  - `@shipfox/api-integration-gitea-dto`: `giteaPushPayloadSchema` (`{ref, after, repository: {name, full_name, default_branch, owner: {username}}}`).
  - `@shipfox/api-integration-gitea`: `POST /webhooks/integrations/gitea` (`auth: []`, `rawBodyPlugin`, standard webhook body limit). It verifies the `X-Gitea-Signature` header as hex HMAC-SHA256 of the raw body keyed by `GITEA_WEBHOOK_SECRET` (401 on mismatch), records non-`push` events for delivery dedup and returns 204, and on a `push` resolves the org (`repository.owner.username`, lower-cased to match the stored org) to its connection, drops branch deletions and unknown orgs, and publishes a normalized `SourcePushPayload` (`externalRepositoryId: gitea:<owner>/<repo>` built from `owner.username`/`repository.name` to match the source-control adapter, `refs/heads/` stripped, `headCommitSha: after`, `isDefaultBranch`). `getGiteaConnectionByOrg` gains an optional transaction executor so the lookup runs inside the publishing transaction. The webhook is registered out of band by the Gitea instance admin, so the connect flow registers nothing.
  - `@shipfox/api-integration-core`: wire `publishSourcePush`, `recordDeliveryOnly`, `getIntegrationConnectionById`, and the core database into the Gitea provider, mirroring GitHub.
  - `@shipfox/node-fastify`: add a shared `verifyHexHmacSignature` helper for hex HMAC-SHA256 webhook signatures.
  - `@shipfox/api-integration-sentry`: `verifySentrySignature` now delegates to the shared helper.

  A push to a connected org's repo creates a workflow run through the existing pipeline. Duplicate POSTs of the same delivery are deduped via `X-Gitea-Delivery`; note that a manual "Redeliver" in Gitea mints a new delivery id and intentionally produces a fresh run (unlike GitHub, whose redelivery reuses the original id and is suppressed).

- 0667cce: Skip publishing source pushes for non-active integration connections. Both the GitHub and Gitea push webhook handlers now treat a connection whose `lifecycleStatus` is not `active` (disabled/error) like an unknown one: the delivery is recorded for dedup but no source-push event is published, so a disabled connection no longer triggers workflow runs.
- 82d22e4: Make the workspace-membership gate stateless. `requireWorkspaceAccess` now lives in `@shipfox/api-auth-context` and authorizes a request purely from the verified session-token claims, replacing the `requireMembership` gate in `@shipfox/api-workspaces` that read the workspace row from the database on every workspace-scoped request. Membership and role already travel in the token, so the check needs no database access.

  This removes the per-request database read and severs the runtime dependency on `@shipfox/api-workspaces` from feature modules that only needed the membership gate (integration providers, secrets, projects, agent, runners). Workspace existence and `active`-status enforcement, which no code path currently exercises, moves off the hot path; enforce it at token issuance when workspace suspension is introduced.

- Updated dependencies [34ba284]
- Updated dependencies [5707d6d]
- Updated dependencies [b9c3f32]
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
- Updated dependencies [58f51bd]
- Updated dependencies [570ac69]
- Updated dependencies [857fd73]
- Updated dependencies [b8e49ff]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [82d22e4]
- Updated dependencies [01be723]
- Updated dependencies [2933c33]
- Updated dependencies [6181819]
  - @shipfox/node-fastify@0.2.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-integration-core-dto@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/api-integration-gitea-dto@0.0.1
  - @shipfox/config@1.2.0
