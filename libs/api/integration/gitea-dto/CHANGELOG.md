# @shipfox/api-integration-gitea-dto

## 22.0.0

### Patch Changes

- Updated dependencies [c392dfb]
  - @shipfox/api-integration-core-dto@22.0.0

## 21.0.0

### Patch Changes

- Updated dependencies [b6298b8]
- Updated dependencies [5886bf2]
  - @shipfox/api-integration-core-dto@21.0.0

## 20.1.0

### Patch Changes

- Updated dependencies [bb334f7]
- Updated dependencies [7467ee6]
  - @shipfox/api-integration-core-dto@20.1.0

## 20.0.0

### Patch Changes

- Updated dependencies [db83e6c]
- Updated dependencies [ec39327]
- Updated dependencies [351f02c]
  - @shipfox/api-integration-core-dto@20.0.0

## 19.0.0

### Patch Changes

- Updated dependencies [b416c4c]
- Updated dependencies [a52cd6d]
- Updated dependencies [75a54d1]
  - @shipfox/api-integration-core-dto@19.0.0

## 18.0.0

### Patch Changes

- Updated dependencies [b2aad90]
  - @shipfox/api-integration-core-dto@18.0.0

## 16.0.0

### Patch Changes

- Updated dependencies [568c90b]
  - @shipfox/api-integration-core-dto@16.0.0

## 15.0.0

### Patch Changes

- @shipfox/api-integration-core-dto@15.0.0

## 14.0.0

### Minor Changes

- 1b71a66: Exposes each provider's event catalog and the fixed-event providers on the integration validation context. Every provider now refuses the reserved `manual` and `cron` connection slugs.

### Patch Changes

- Updated dependencies [18e9bad]
- Updated dependencies [c44641f]
- Updated dependencies [1b71a66]
  - @shipfox/api-integration-core-dto@14.0.0

## 12.2.0

### Patch Changes

- Updated dependencies [7901a60]
  - @shipfox/api-integration-core-dto@12.2.0

## 12.0.0

### Patch Changes

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

### Patch Changes

- Updated dependencies [6b23868]
  - @shipfox/api-integration-core-dto@3.0.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-integration-core-dto@2.0.0

## 0.0.1

### Patch Changes

- 58f51bd: Scaffold an empty `gitea` integration provider that mirrors the `github` package structure, ahead of any behavior.
  - New `@shipfox/api-integration-gitea` + `@shipfox/api-integration-gitea-dto` packages: `createGiteaIntegrationProvider()` returns an empty provider (`{provider: 'gitea', displayName: 'Gitea', adapters: {}, routes: []}`), plus a `src/config.ts` documenting the self-hoster variables (`GITEA_BASE_URL`, `GITEA_SERVICE_USERNAME`, `GITEA_SERVICE_TOKEN`, `GITEA_WEBHOOK_SECRET`, `GITEA_WEBHOOK_TARGET_URL`, `GITEA_CHECKOUT_TTL_SECONDS`) and an empty provider database wired with the stable migrations table `__drizzle_migrations_integrations_gitea`.
  - `@shipfox/api-integration-core`: register the Gitea provider behind `INTEGRATIONS_ENABLE_GITEA_PROVIDER` (default false). With the flag enabled, `gitea` appears in `GET /integration-providers`. Dormant scaffold; no runtime behavior yet.

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

- Updated dependencies [115655e]
- Updated dependencies [ce062a9]
- Updated dependencies [f3614ae]
- Updated dependencies [f8f339a]
- Updated dependencies [b8e49ff]
- Updated dependencies [d6d4862]
- Updated dependencies [01be723]
- Updated dependencies [2933c33]
  - @shipfox/api-integration-core-dto@0.1.0
