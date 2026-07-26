# @shipfox/api-integration-linear

## 9.3.0

### Patch Changes

- Updated dependencies [4425c6d]
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/api-auth-context@9.3.0
  - @shipfox/node-fastify@0.3.4

## 9.2.0

### Patch Changes

- @shipfox/api-auth-context@9.2.0

## 9.1.0

### Patch Changes

- ce9a452: Links Linear connections directly to the installed application's settings page.

## 9.0.3

### Patch Changes

- @shipfox/node-fastify@0.3.3
- @shipfox/api-auth-context@9.0.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-auth-context@9.0.2
  - @shipfox/api-integration-linear-dto@9.0.2
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
  - @shipfox/api-integration-linear-dto@9.0.1
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
  - @shipfox/api-integration-linear-dto@9.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-postgres@0.4.2

## 8.0.0

### Patch Changes

- Updated dependencies [7f227c6]
  - @shipfox/api-integration-core-dto@8.0.0
  - @shipfox/api-integration-linear-dto@8.0.0

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

- f262539: Adds a composed webhook processor and optional provider-neutral delivery source for hosted API runtimes.
- a42b575: Exposes Secrets through its inter-module contract and migrates Agent, integrations, and Workflows consumers.
- 8aa7cd3: Adds a shared Linear webhook processor that preserves raw-body signatures and receipt-time replay validation.

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
  - @shipfox/api-integration-linear-dto@6.0.0

## 5.0.0

### Minor Changes

- fb70438: Cascades provider installation and token deletion when removing a connection.

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [2875241]
- Updated dependencies [bb037af]
- Updated dependencies [fb70438]
  - @shipfox/api-integration-core-dto@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-integration-linear-dto@5.0.0
  - @shipfox/api-secrets@5.0.0
  - @shipfox/api-workspaces@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-postgres@0.4.2

## 4.0.0

### Patch Changes

- bbba3b7: Adds the Slack integration provider scaffold with installation storage, bot-token custody, and flag-gated registration.
- Updated dependencies [bbba3b7]
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-secrets@4.0.0
  - @shipfox/api-workspaces@4.0.0

## 3.0.0

### Patch Changes

- Updated dependencies [6b23868]
- Updated dependencies [7a71e7d]
  - @shipfox/api-integration-core-dto@3.0.0
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/api-secrets@3.0.0
  - @shipfox/api-workspaces@3.0.0
  - @shipfox/api-integration-linear-dto@3.0.0
  - @shipfox/node-fastify@0.2.2
  - @shipfox/api-auth-context@3.0.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [c31a7e0]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/api-workspaces@2.0.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-integration-core-dto@2.0.0
  - @shipfox/api-integration-linear-dto@2.0.0
  - @shipfox/api-secrets@2.0.0
  - @shipfox/config@1.2.1
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-postgres@0.4.1

## 1.0.2

### Patch Changes

- @shipfox/api-secrets@0.1.2
- @shipfox/api-workspaces@0.1.2

## 1.0.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/api-secrets@0.1.1
  - @shipfox/api-workspaces@0.1.1

## 1.0.0

### Patch Changes

- 43d7996: Adds the Linear OAuth connect experience to workspace integration settings.
- 0948b67: Scaffolds the Linear integration provider, package pair, config, and installation store behind the core provider flag.
- 8958753: Adds Linear OAuth client and token custody primitives for storing and refreshing workspace connection tokens.
- 6297b06: Adds the curated Linear agent tool catalog with broad workspace tool metadata for authoring validation and future audit.
- Updated dependencies [0948b67]
- Updated dependencies [34ba284]
- Updated dependencies [3b45d86]
- Updated dependencies [5707d6d]
- Updated dependencies [b9c3f32]
- Updated dependencies [d02c5fd]
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
- Updated dependencies [857fd73]
- Updated dependencies [f66f606]
- Updated dependencies [e51d464]
- Updated dependencies [b8e49ff]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [82d22e4]
- Updated dependencies [01be723]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [6181819]
- Updated dependencies [3ddde91]
  - @shipfox/api-integration-linear-dto@0.0.1
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-secrets@0.1.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-workspaces@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-integration-core-dto@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/config@1.2.0
