# @shipfox/api-workspaces-dto

## 10.2.0

### Minor Changes

- 07e7371: Add idempotent administrator workspace suspension and reactivation commands with atomic redacted administration events.

## 10.0.0

### Minor Changes

- e9280fc: Add an observer-authorized administrator workspace lookup with bounded safe summaries,
  best-effort job counts, and a neutral unavailable-workspace member experience for
  suspended or deleted workspaces.

### Patch Changes

- @shipfox/api-common-dto@9.2.0
- @shipfox/inter-module@0.2.2

## 9.3.0

### Minor Changes

- 7b6a409: Adds the checked Workspace operating-state contract for job-admission owners.

## 9.2.0

### Patch Changes

- Updated dependencies [36d8338]
  - @shipfox/api-common-dto@9.2.0

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-common-dto@9.0.2
  - @shipfox/inter-module@0.2.2

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/api-common-dto@9.0.1
  - @shipfox/inter-module@0.2.1

## 9.0.0

### Minor Changes

- 9c9d266: Adds a producer-owned workspace creator lookup for inter-module consumers.

### Patch Changes

- @shipfox/api-common-dto@6.0.0
- @shipfox/inter-module@0.2.0

## 6.0.0

### Minor Changes

- 1b79cda: Add a workspace-created domain event.
- c2db8c3: Adds workspace member invitation and join lifecycle events to the workspaces outbox.
- 326f4c0: Exposes Workspaces inter-module operations and moves Auth and OAuth providers onto injected clients.

### Patch Changes

- 4a91956: Publishes a shared provider-neutral `emailSchema` in `@shipfox/api-common-dto` and adopts it across auth and workspace invitation inputs. Adds a read-only `findUserByEmail`/`EmailOwner` seam to `@shipfox/api-auth` for looking up the current owner of a normalized email without creating a session or mutating that user. Extends the packed external consumer gate to exercise both seams against PostgreSQL through installed tarballs.
- Updated dependencies [4a91956]
- Updated dependencies [81f9544]
  - @shipfox/api-common-dto@6.0.0
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/api-common-dto@5.0.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-common-dto@2.0.0

## 0.1.0

### Minor Changes

- d02c5fd: Queues auth and workspace transactional emails through module-owned outbox events so account verification, password reset, and invitation sends retry outside request transactions.

### Patch Changes

- 72ce351: Removes the legacy workspace API-key auth surface, its DTOs, project-access branch, database table, and token prefix support.
- 27770eb: Tightens signup, workspace, and project display-name validation with shared trimming, control and format-character rejection, length limits, and contextual client form errors.
- Updated dependencies [27770eb]
  - @shipfox/api-common-dto@0.1.0
