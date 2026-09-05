# @shipfox/api-integration-spi

## 4.1.1

### Patch Changes

- Updated dependencies [c392dfb]
  - @shipfox/api-integration-core-dto@22.0.0

## 4.1.0

### Minor Changes

- 5e123f1: Enforce repository authorization for GitHub and Gitea checkout targets.

## 4.0.0

### Major Changes

- 5886bf2: Make selected repository access project-only and remove manual repository grants.

### Patch Changes

- Updated dependencies [b6298b8]
- Updated dependencies [5886bf2]
  - @shipfox/api-integration-core-dto@21.0.0

## 3.0.2

### Patch Changes

- be556f0: Adds an opt-in Test VCS provider (`test-vcs`), enabled via `INTEGRATIONS_ENABLE_TEST_VCS_PROVIDER`, and keeps Git branch validation aligned with Git's ref rules.

## 3.0.1

### Patch Changes

- Updated dependencies [bb334f7]
- Updated dependencies [7467ee6]
  - @shipfox/api-integration-core-dto@20.1.0

## 3.0.0

### Major Changes

- 09b8e1e: Persist per-connection repository access modes and manual repository grants.

  The IntegrationConnection contract now requires `repositoryAccessMode`. Consumers
  implementing or constructing connection values must add the field when upgrading
  the core, Gitea, or SPI packages.

### Minor Changes

- ec39327: Projects checkout resolution now requires a project ID and no longer accepts repository names. Checkout requests authorize the repository target before issuing credentials. Repository declarations remain valid without a project association.
- 351f02c: Build GitHub issue and pull request search queries from server-owned repository scope, driven by a new repository-scope classifier on agent tool catalog entries.

### Patch Changes

- Updated dependencies [db83e6c]
- Updated dependencies [ec39327]
- Updated dependencies [351f02c]
  - @shipfox/api-integration-core-dto@20.0.0

## 2.2.0

### Minor Changes

- a52cd6d: Adds checkout targets addressed by stable external IDs or owner/name declarations. Checkout inputs reject ambiguous targets and caller-supplied metadata.

### Patch Changes

- Updated dependencies [b416c4c]
- Updated dependencies [a52cd6d]
- Updated dependencies [75a54d1]
  - @shipfox/api-integration-core-dto@19.0.0

## 2.1.0

### Minor Changes

- b2aad90: Adds `generation` and `renewal` checkout-credential fields and `createCheckoutCredentials`, which accepts the frozen connection, stable repository ID, exact permissions, and rejected generation.

### Patch Changes

- Updated dependencies [b2aad90]
  - @shipfox/api-integration-core-dto@18.0.0

## 2.0.2

### Patch Changes

- Updated dependencies [568c90b]
  - @shipfox/api-integration-core-dto@16.0.0

## 2.0.1

### Patch Changes

- @shipfox/api-integration-core-dto@15.0.0

## 2.0.0

### Major Changes

- 18e9bad: Adds source-control ref resolution that pins branch and tag names to commits.

### Minor Changes

- 1b71a66: Exposes each provider's event catalog and the fixed-event providers on the integration validation context. Every provider now refuses the reserved `manual` and `cron` connection slugs.

### Patch Changes

- Updated dependencies [18e9bad]
- Updated dependencies [c44641f]
- Updated dependencies [1b71a66]
  - @shipfox/api-integration-core-dto@14.0.0

## 1.1.1

### Patch Changes

- f2b20af: Preserve GitHub provider rejection details and classify terminal agent-tool failures without reporting them as provider outages.

## 1.1.0

### Minor Changes

- e0110fe: Adds Jira webhook renewal and disconnect deregistration support.

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
