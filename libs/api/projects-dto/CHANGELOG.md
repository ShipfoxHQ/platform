# @shipfox/api-projects-dto

## 12.0.0

### Major Changes

- 4eb18b8: Add required, workspace-scoped project slugs across the API and project creation form.

### Minor Changes

- 8cc5a36: Add a `resolveCheckoutTarget` inter-module method. It resolves a project by ID
  or by owner and repository within a workspace for callers that authorize a
  checkout target.
- 032d316: Scope checkout credential minting to the currently running checkout step and return its fetch depth.
- cb0abfa: Expose the normalized trigger project, repository, ref, and commit in workflow context.

### Patch Changes

- Updated dependencies [f78740d]
- Updated dependencies [34a5639]
  - @shipfox/api-common-dto@12.0.0
  - @shipfox/inter-module@0.2.3

## 10.1.0

### Minor Changes

- 88ae689: Add a bounded, administrator-authorized project summary route with redacted fields and cursor pagination.

## 10.0.0

### Minor Changes

- e9280fc: Add an observer-authorized administrator workspace lookup with bounded safe summaries,
  best-effort job counts, and a neutral unavailable-workspace member experience for
  suspended or deleted workspaces.

### Patch Changes

- @shipfox/api-common-dto@9.2.0
- @shipfox/inter-module@0.2.2

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

## 8.0.0

### Major Changes

- 7f227c6: Moves Projects and Integrations synchronous contracts to producer-owned inter-module entry points.

## 6.0.0

### Patch Changes

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

- 43fd0c1: Adds HTTP-first E2E project setup contracts and routes for creating synthetic projects without source-control setup.

### Patch Changes

- 27770eb: Tightens signup, workspace, and project display-name validation with shared trimming, control and format-character rejection, length limits, and contextual client form errors.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- Updated dependencies [27770eb]
  - @shipfox/api-common-dto@0.1.0
