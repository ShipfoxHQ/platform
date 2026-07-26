# @shipfox/api-integration-slack

## 9.3.0

### Patch Changes

- Updated dependencies [4425c6d]
- Updated dependencies [7b6a409]
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/api-workspaces-dto@9.3.0
  - @shipfox/api-auth-context@9.3.0
  - @shipfox/node-fastify@0.3.4

## 9.2.0

### Patch Changes

- @shipfox/api-workspaces-dto@9.2.0
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
  - @shipfox/api-integration-slack-dto@9.0.2
  - @shipfox/api-integration-spi@0.2.2
  - @shipfox/api-workspaces-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-fastify@0.3.2
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/node-postgres@0.4.4

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/api-integration-slack-dto@9.0.1
  - @shipfox/api-integration-spi@0.2.1
  - @shipfox/api-workspaces-dto@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/inter-module@0.2.1
  - @shipfox/node-drizzle@0.3.3
  - @shipfox/node-fastify@0.3.1
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-postgres@0.4.3

## 9.0.0

### Patch Changes

- 4a6d124: Separates Integrations provider SPI contracts from the public DTO surface.
- Updated dependencies [9c9d266]
- Updated dependencies [4a6d124]
  - @shipfox/api-workspaces-dto@9.0.0
  - @shipfox/api-integration-spi@0.2.0
  - @shipfox/api-auth-context@9.0.0
  - @shipfox/api-integration-slack-dto@9.0.0
  - @shipfox/config@1.2.2
  - @shipfox/inter-module@0.2.0
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-postgres@0.4.2

## 8.0.0

### Patch Changes

- Updated dependencies [7f227c6]
  - @shipfox/api-integration-core-dto@8.0.0
  - @shipfox/api-integration-slack-dto@8.0.0

## 7.1.0

### Patch Changes

- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/api-auth-context@7.1.0

## 6.0.0

### Minor Changes

- 40a6e0f: Adds shared processing for signed Slack event and command webhook deliveries.
- f262539: Adds a composed webhook processor and optional provider-neutral delivery source for hosted API runtimes.
- a42b575: Exposes Secrets through its inter-module contract and migrates Agent, integrations, and Workflows consumers.

### Patch Changes

- 3bb4e26: Fixes composed webhook processing and exposes Slack URL-verification responses through the shared contract.
- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- 326f4c0: Exposes Workspaces inter-module operations and moves Auth and OAuth providers onto injected clients.
- 1820feb: Adds Slack Settings installation and callback recovery while returning stable workspace access errors.
- Updated dependencies [0bb82a4]
- Updated dependencies [7ac43a4]
- Updated dependencies [f262539]
- Updated dependencies [3bb4e26]
- Updated dependencies [1b79cda]
- Updated dependencies [c2db8c3]
- Updated dependencies [8bdc149]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [326f4c0]
- Updated dependencies [4a91956]
- Updated dependencies [81f9544]
- Updated dependencies [4604a06]
  - @shipfox/api-integration-core-dto@6.0.0
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/api-workspaces-dto@6.0.0
  - @shipfox/api-auth-context@6.0.0
  - @shipfox/node-fastify@0.2.4
  - @shipfox/inter-module@0.2.0
  - @shipfox/api-integration-slack-dto@6.0.0

## 5.0.0

### Minor Changes

- 2875241: Adds deduplicated Slack installation revocation for app uninstall and bot token-revocation events.
- fb70438: Cascades provider installation and token deletion when removing a connection.

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [2875241]
- Updated dependencies [bb037af]
- Updated dependencies [fb70438]
  - @shipfox/api-integration-slack-dto@5.0.0
  - @shipfox/api-integration-core-dto@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-secrets@5.0.0
  - @shipfox/api-workspaces@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-postgres@0.4.2

## 4.0.0

### Minor Changes

- 67176d4: Adds the Slack OAuth connection flow with provider routes, secure bot-token storage, and E2E setup.
- 7267872: Adds signed Slack Events API and slash-command receivers that publish normalized integration events without persisting command verification tokens.
- bbba3b7: Adds the Slack integration provider scaffold with installation storage, bot-token custody, and flag-gated registration.

### Patch Changes

- 0745ee9: Prevents Slack bot tokens from being read for revoked, expired, or missing installations.
- 23c8e4d: Rejects Slack OAuth grants that enable unsupported token rotation.
- 1951293: Adds in-process Slack agent tools for reading conversations and acting on messages through the lease-authenticated gateway.
- Updated dependencies [dda7c54]
- Updated dependencies [7267872]
- Updated dependencies [bbba3b7]
  - @shipfox/api-integration-slack-dto@4.0.0
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-secrets@4.0.0
  - @shipfox/api-workspaces@4.0.0
