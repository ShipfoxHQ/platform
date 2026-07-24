# @shipfox/api-secrets-dto

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/inter-module@0.2.2

## 9.0.1

### Patch Changes

- 8436596: Adds Dependency Cruiser checks to all classified API packages so source-edge enforcement remains active after retiring the duplicate import scan.
- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/inter-module@0.2.1

## 9.0.0

### Major Changes

- 02974d6: Removes executable policy and test fixtures from public API DTO roots.

### Patch Changes

- @shipfox/inter-module@0.2.0

## 6.0.0

### Minor Changes

- a42b575: Exposes Secrets through its inter-module contract and migrates Agent, integrations, and Workflows consumers.

### Patch Changes

- Updated dependencies [81f9544]
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 0.1.0

### Minor Changes

- 3b45d86: Adds the secrets and variables backend foundation with encrypted secret storage, plaintext variables, and shared DTO contracts.
- 3ddde91: Adds the secrets and variables management API with DTO contracts, exact-scope storage helpers, outbox events, and workspace-admin route guards.

### Patch Changes

- f66f606: Test suites can create managed secrets and variables through protected setup APIs.
- e51d464: Add the Secrets & Variables workspace settings UI (S1b).
  - New `@shipfox/client-secrets` package: transport + React Query hooks (a shared
    `createStoreApi` factory), a write-only secret form and a readable variable form
    (TanStack Form + Zod, multiline `Textarea` values, live short-value / sensitive-name
    advisories), and the workspace secrets/variables sections (single-call list, masked
    secret values, copy-name, delete with blast-radius warning).
  - `@shipfox/client-workspace-settings`: new Secrets and Variables settings pages and nav
    entries.
  - `@shipfox/api-secrets-dto`: export `SECRETS_MAX_LIST_LIMIT` and raise the list `limit`
    cap so the settings UI can fetch the whole bounded set in one request; the variable
    list item now carries `value_truncated`.
  - `@shipfox/api-secrets`: the variable list returns a bounded single-line preview of each
    value (the full value is read via `GET /variables/:key` when editing) so a single-call
    list cannot materialize very large responses; startup fails if `SECRETS_MAX_PER_WORKSPACE`
    exceeds the list limit.
  - `@shipfox/client-router`: register the `/workspaces/$wid/settings/secrets` and
    `/variables` routes.
