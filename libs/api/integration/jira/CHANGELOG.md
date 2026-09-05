# @shipfox/api-integration-jira

## 22.0.0

### Patch Changes

- @shipfox/api-integration-jira-dto@22.0.0
- @shipfox/api-integration-spi@4.1.1

## 21.2.0

### Patch Changes

- Updated dependencies [0745878]
- Updated dependencies [5e123f1]
  - @shipfox/node-module@1.0.10
  - @shipfox/api-integration-spi@4.1.0

## 21.0.0

### Patch Changes

- Updated dependencies [5886bf2]
  - @shipfox/api-integration-spi@4.0.0
  - @shipfox/api-integration-jira-dto@21.0.0

## 20.4.0

### Patch Changes

- Updated dependencies [0b32d1a]
  - @shipfox/api-auth-context@20.4.0

## 20.2.0

### Patch Changes

- Updated dependencies [ba481d6]
- Updated dependencies [be556f0]
  - @shipfox/node-fastify@0.4.4
  - @shipfox/api-integration-spi@3.0.2
  - @shipfox/api-auth-context@20.2.0
  - @shipfox/node-module@1.0.9

## 20.1.0

### Patch Changes

- Updated dependencies [2bf937b]
  - @shipfox/api-auth-context@20.1.0
  - @shipfox/api-integration-jira-dto@20.1.0
  - @shipfox/api-integration-spi@3.0.1

## 20.0.0

### Patch Changes

- Updated dependencies [ec39327]
- Updated dependencies [09b8e1e]
- Updated dependencies [351f02c]
  - @shipfox/api-integration-spi@3.0.0
  - @shipfox/api-auth-context@20.0.0
  - @shipfox/api-integration-jira-dto@20.0.0

## 19.0.0

### Patch Changes

- b416c4c: Preserves existing package behavior while simplifying internal control flow.
- Updated dependencies [b416c4c]
- Updated dependencies [a52cd6d]
  - @shipfox/api-auth-context@19.0.0
  - @shipfox/node-module@1.0.8
  - @shipfox/api-integration-spi@2.2.0
  - @shipfox/api-integration-jira-dto@19.0.0
  - @shipfox/config@1.2.4
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-fastify@0.4.3
  - @shipfox/node-jwt@0.4.0
  - @shipfox/node-opentelemetry@0.6.5
  - @shipfox/node-postgres@0.5.1

## 18.0.0

### Patch Changes

- Updated dependencies [b2aad90]
  - @shipfox/api-integration-spi@2.1.0
  - @shipfox/api-auth-context@18.0.0
  - @shipfox/api-integration-jira-dto@18.0.0

## 17.0.0

### Patch Changes

- Updated dependencies [a4f56ff]
- Updated dependencies [a591e8a]
- Updated dependencies [9f898d9]
  - @shipfox/api-auth-context@17.0.0
  - @shipfox/node-postgres@0.5.1

## 16.0.0

### Patch Changes

- @shipfox/api-integration-jira-dto@16.0.0
- @shipfox/api-integration-spi@2.0.2

## 15.0.0

### Patch Changes

- @shipfox/node-opentelemetry@0.6.5
- @shipfox/api-integration-jira-dto@15.0.0
- @shipfox/api-integration-spi@2.0.1
- @shipfox/node-fastify@0.4.3
- @shipfox/node-module@1.0.7
- @shipfox/api-auth-context@15.0.0

## 14.0.0

### Minor Changes

- 1b71a66: Exposes each provider's event catalog and the fixed-event providers on the integration validation context. Every provider now refuses the reserved `manual` and `cron` connection slugs.

### Patch Changes

- Updated dependencies [18e9bad]
- Updated dependencies [2323e2e]
- Updated dependencies [1b71a66]
  - @shipfox/api-integration-spi@2.0.0
  - @shipfox/api-integration-jira-dto@14.0.0

## 12.5.0

### Patch Changes

- Updated dependencies [f2b20af]
  - @shipfox/api-integration-spi@1.1.1

## 12.4.0

### Patch Changes

- a566809: Registers Jira dynamic webhooks with a non-empty all-issues JQL filter.

## 12.3.0

### Minor Changes

- e0110fe: Adds Jira webhook renewal and disconnect deregistration support.

### Patch Changes

- Updated dependencies [e0110fe]
  - @shipfox/api-integration-spi@1.1.0

## 12.2.0

### Minor Changes

- 9695359: Cleans up Jira installation records and tokens when a workspace deletes an integration so the site can be reinstalled.

### Patch Changes

- @shipfox/api-integration-jira-dto@12.2.0
- @shipfox/api-integration-spi@1.0.1
- @shipfox/node-opentelemetry@0.6.4
- @shipfox/node-fastify@0.4.2
- @shipfox/node-module@1.0.6
- @shipfox/api-auth-context@12.2.0

## 12.1.1

### Patch Changes

- 4636839: Logs bounded provider reasons when Jira rejects dynamic webhook registration.
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/api-integration-jira-dto@12.0.0
  - @shipfox/api-integration-spi@1.0.0
  - @shipfox/config@1.2.4
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-fastify@0.4.1
  - @shipfox/node-jwt@0.4.0
  - @shipfox/node-module@1.0.5
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-postgres@0.5.0

## 12.1.0

### Minor Changes

- 70e33c0: Adds the in-process Jira REST agent-tool catalog and write-selection support.

### Patch Changes

- af7adfc: Adds a six-hour Jira refresh-token maintenance worker that refreshes idle tokens and migrates existing installations with backfilled refresh state. Token access now fails closed for non-active connections, and rejected refresh tokens or ambiguous refresh timeouts require reconnecting Jira.

## 12.0.0

### Major Changes

- f13e8bb: Add Jira dynamic webhook registration and authenticated event ingestion through
  the shared stored-webhook workflow. Update the SPI webhook request exports and
  serialize Jira installation replacement across API replicas. Preserve Jira
  delivery identifiers and require lifecycle callbacks for registration. Remove
  the unused Jira webhook signing-secret configuration and allow HS256 verification
  at a supplied receipt time.

### Patch Changes

- Updated dependencies [f78740d]
- Updated dependencies [24ef475]
- Updated dependencies [f13e8bb]
- Updated dependencies [869a792]
- Updated dependencies [54c820e]
  - @shipfox/node-fastify@0.4.1
  - @shipfox/api-integration-spi@1.0.0
  - @shipfox/node-jwt@0.4.0
  - @shipfox/node-postgres@0.5.0
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/api-integration-jira-dto@12.0.0
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
  - @shipfox/api-integration-jira-dto@9.0.2
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
  - @shipfox/api-integration-jira-dto@9.0.2
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
  - @shipfox/api-integration-jira-dto@9.0.1
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
  - @shipfox/api-integration-jira-dto@9.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-postgres@0.4.2

## 8.0.0

### Patch Changes

- Updated dependencies [7f227c6]
  - @shipfox/api-integration-core-dto@8.0.0
  - @shipfox/api-integration-jira-dto@8.0.0

## 7.1.0

### Patch Changes

- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
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

- a42b575: Exposes Secrets through its inter-module contract and migrates Agent, integrations, and Workflows consumers.

### Patch Changes

- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
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
  - @shipfox/api-integration-jira-dto@6.0.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- 43d8e66: Adds Jira OAuth connection support with site selection and rotating access tokens.
- Updated dependencies [2875241]
- Updated dependencies [bb037af]
- Updated dependencies [43d8e66]
- Updated dependencies [fb70438]
  - @shipfox/api-integration-core-dto@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-integration-jira-dto@5.0.0
  - @shipfox/api-secrets@5.0.0
  - @shipfox/api-workspaces@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-postgres@0.4.2

## 4.0.0

### Patch Changes

- Updated dependencies [15c5f84]
- Updated dependencies [bbba3b7]
  - @shipfox/api-integration-jira-dto@4.0.0
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-secrets@4.0.0
