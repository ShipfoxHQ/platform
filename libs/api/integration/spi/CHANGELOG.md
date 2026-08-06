# @shipfox/api-integration-spi

## 1.0.1

### Patch Changes

- Updated dependencies [7901a60]
  - @shipfox/api-integration-core-dto@12.2.0

## 1.0.0

### Major Changes

- 54c820e: Capture the actor that caused a source-control event on the normalized trigger reference. `TriggerReference` gains a required `actor`, resolved from the webhook sender by the GitHub and Gitea providers and null for payloads that name none.

### Minor Changes

- 24ef475: Adds provider-normalized repository, ref, and commit extraction for source-control trigger payloads.
- f13e8bb: Add Jira dynamic webhook registration and authenticated event ingestion through
  the shared stored-webhook workflow. Update the SPI webhook request exports and
  serialize Jira installation replacement across API replicas. Preserve Jira
  delivery identifiers and require lifecycle callbacks for registration. Remove
  the unused Jira webhook signing-secret configuration and allow HS256 verification
  at a supplied receipt time.
- 869a792: Refresh source-backed project repository identity from GitHub repository and installation-repository events.

### Patch Changes

- Updated dependencies [f13e8bb]
- Updated dependencies [869a792]
- Updated dependencies [032d316]
- Updated dependencies [54c820e]
- Updated dependencies [cb0abfa]
  - @shipfox/api-integration-core-dto@12.0.0

## 0.2.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-integration-core-dto@9.0.2

## 0.2.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/api-integration-core-dto@9.0.1

## 0.2.0

### Minor Changes

- 4a6d124: Separates Integrations provider SPI contracts from the public DTO surface.

### Patch Changes

- Updated dependencies [02974d6]
- Updated dependencies [4a6d124]
  - @shipfox/api-integration-core-dto@9.0.0
