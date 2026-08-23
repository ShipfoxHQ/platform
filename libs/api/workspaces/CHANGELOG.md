# @shipfox/api-workspaces

## 13.1.0

### Patch Changes

- Updated dependencies [6366319]
  - @shipfox/node-email@0.3.5

## 13.0.0

### Patch Changes

- Updated dependencies [af6b31e]
  - @shipfox/api-runners-dto@13.0.0

## 12.4.0

### Patch Changes

- Updated dependencies [9e16946]
- Updated dependencies [4fa8526]
  - @shipfox/api-runners-dto@12.4.0

## 12.2.0

### Patch Changes

- Updated dependencies [78b771c]
- Updated dependencies [7901a60]
  - @shipfox/api-runners-dto@12.2.0
  - @shipfox/api-projects-dto@12.2.0
  - @shipfox/node-opentelemetry@0.6.4
  - @shipfox/node-fastify@0.4.2
  - @shipfox/node-mailer@0.2.5
  - @shipfox/node-module@1.0.6
  - @shipfox/api-auth-context@12.2.0

## 12.0.0

### Minor Changes

- 9ebc5b4: Add an authenticated, rate-limited workspace slug availability endpoint.
- e1efaee: Add workspace slugs across the API and client workspace contracts.

### Patch Changes

- f78740d: Remove Unicode dash punctuation from package prose and source comments.
- Updated dependencies [f78740d]
- Updated dependencies [94aba88]
- Updated dependencies [4eb18b8]
- Updated dependencies [f13e8bb]
- Updated dependencies [9ebc5b4]
- Updated dependencies [8cc5a36]
- Updated dependencies [34a5639]
- Updated dependencies [032d316]
- Updated dependencies [cb0abfa]
- Updated dependencies [e1efaee]
  - @shipfox/api-auth-dto@12.0.0
  - @shipfox/api-common-dto@12.0.0
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-fastify@0.4.1
  - @shipfox/node-module@1.0.5
  - @shipfox/api-workspaces-dto@12.0.0
  - @shipfox/api-projects-dto@12.0.0
  - @shipfox/node-postgres@0.5.0
  - @shipfox/node-rate-limit@0.4.0
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/api-runners-dto@12.0.0
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-outbox@0.2.6

## 11.0.0

### Major Changes

- 25158c8: Carry workspace lifecycle status in JWT membership claims and enforce suspended or inactive access at the stateless workspace gate while keeping access-token verification stateless.

  `getAuthenticatedSessionContext()` now reads refresh-session metadata from verified access-token claims without checking active refresh-session state; revoking a refresh session does not invalidate an already-issued access token.

### Patch Changes

- Updated dependencies [25158c8]
  - @shipfox/api-auth-context@11.0.0
  - @shipfox/api-workspaces-dto@11.0.0

## 10.2.0

### Minor Changes

- 07e7371: Add idempotent administrator workspace suspension and reactivation commands with atomic redacted administration events.

### Patch Changes

- Updated dependencies [c9a188d]
- Updated dependencies [8678943]
- Updated dependencies [95d1456]
- Updated dependencies [0773b85]
- Updated dependencies [6be5a54]
- Updated dependencies [07e7371]
  - @shipfox/api-runners-dto@10.2.0
  - @shipfox/api-auth-dto@10.2.0
  - @shipfox/api-workspaces-dto@10.2.0
  - @shipfox/api-auth-context@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [88ae689]
- Updated dependencies [fb34b6a]
  - @shipfox/api-projects-dto@10.1.0
  - @shipfox/api-auth-dto@10.1.0
  - @shipfox/api-auth-context@10.1.0

## 10.0.0

### Minor Changes

- e9280fc: Add an observer-authorized administrator workspace lookup with bounded safe summaries,
  best-effort job counts, and a neutral unavailable-workspace member experience for
  suspended or deleted workspaces.

### Patch Changes

- Updated dependencies [6054364]
- Updated dependencies [74f9e31]
- Updated dependencies [e9280fc]
- Updated dependencies [837bf5d]
- Updated dependencies [3f5610b]
  - @shipfox/api-auth-dto@10.0.0
  - @shipfox/node-fastify@0.4.0
  - @shipfox/api-workspaces-dto@10.0.0
  - @shipfox/api-projects-dto@10.0.0
  - @shipfox/api-runners-dto@10.0.0
  - @shipfox/api-auth-context@10.0.0
  - @shipfox/node-module@1.0.4
  - @shipfox/api-common-dto@9.2.0
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-email@0.3.4
  - @shipfox/node-mailer@0.2.4
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-postgres@0.4.4
  - @shipfox/node-tokens@0.3.2

## 9.3.0

### Patch Changes

- 7b6a409: Adds the checked Workspace operating-state contract for job-admission owners.
- Updated dependencies [4425c6d]
- Updated dependencies [7b6a409]
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/api-workspaces-dto@9.3.0
  - @shipfox/api-auth-context@9.3.0
  - @shipfox/node-fastify@0.3.4
  - @shipfox/node-mailer@0.2.4
  - @shipfox/node-module@1.0.3

## 9.2.0

### Patch Changes

- Updated dependencies [36d8338]
  - @shipfox/api-common-dto@9.2.0
  - @shipfox/api-workspaces-dto@9.2.0
  - @shipfox/api-auth-context@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [56e2c58]
  - @shipfox/node-email@0.3.4

## 9.0.3

### Patch Changes

- @shipfox/node-fastify@0.3.3
- @shipfox/node-module@1.0.2
- @shipfox/api-auth-context@9.0.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-auth-context@9.0.2
  - @shipfox/api-common-dto@9.0.2
  - @shipfox/api-workspaces-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-email@0.3.3
  - @shipfox/node-fastify@0.3.2
  - @shipfox/node-mailer@0.2.3
  - @shipfox/node-module@1.0.1
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-postgres@0.4.4
  - @shipfox/node-tokens@0.3.2

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- cd28a05: Prefixes the Workspaces root table in the migration baseline.
- Updated dependencies [475ce59]
- Updated dependencies [154e03f]
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/api-common-dto@9.0.1
  - @shipfox/api-workspaces-dto@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/inter-module@0.2.1
  - @shipfox/node-drizzle@0.3.3
  - @shipfox/node-email@0.3.2
  - @shipfox/node-fastify@0.3.1
  - @shipfox/node-mailer@0.2.2
  - @shipfox/node-module@1.0.0
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-outbox@0.2.5
  - @shipfox/node-postgres@0.4.3
  - @shipfox/node-tokens@0.3.1

## 9.0.0

### Minor Changes

- 9c9d266: Adds a producer-owned workspace creator lookup for inter-module consumers.

### Patch Changes

- Updated dependencies [9c9d266]
  - @shipfox/api-workspaces-dto@9.0.0
  - @shipfox/api-auth-context@9.0.0
  - @shipfox/api-common-dto@6.0.0
  - @shipfox/config@1.2.2
  - @shipfox/inter-module@0.2.0
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-email@0.3.1
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-mailer@0.2.1
  - @shipfox/node-module@0.5.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-outbox@0.2.4
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-tokens@0.3.0

## 7.1.0

### Patch Changes

- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/api-auth-context@7.1.0
  - @shipfox/node-mailer@0.2.1

## 7.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/node-email@0.3.1

## 7.0.0

### Patch Changes

- Updated dependencies [4d7c87e]
  - @shipfox/node-email@0.3.0

## 6.0.0

### Minor Changes

- 6bdf24b: Adds idempotent workspace invitation reconciliation for retry-safe external acceptance flows.
- 326f4c0: Exposes Workspaces inter-module operations and moves Auth and OAuth providers onto injected clients.
- 1820feb: Adds Slack Settings installation and callback recovery while returning stable workspace access errors.

### Patch Changes

- 7366f04: Adds a configured shared mailer that owns SMTP delivery settings. `@shipfox/api-auth` and `@shipfox/api-workspaces` drop their own mailer environment variables and factory logic and use the shared `mailer` from `@shipfox/node-mailer` instead.
- c2db8c3: Adds workspace member invitation and join lifecycle events to the workspaces outbox.
- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- Updated dependencies [b70f920]
- Updated dependencies [7366f04]
- Updated dependencies [54ce48b]
- Updated dependencies [c0162b0]
- Updated dependencies [7ac43a4]
- Updated dependencies [a01e917]
- Updated dependencies [1b79cda]
- Updated dependencies [c2db8c3]
- Updated dependencies [8bdc149]
- Updated dependencies [3810996]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [326f4c0]
- Updated dependencies [4a91956]
- Updated dependencies [81f9544]
  - @shipfox/node-tokens@0.3.0
  - @shipfox/node-mailer@0.2.0
  - @shipfox/node-module@0.4.0
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-outbox@0.2.4
  - @shipfox/api-workspaces-dto@6.0.0
  - @shipfox/api-auth-context@6.0.0
  - @shipfox/node-fastify@0.2.4
  - @shipfox/api-common-dto@6.0.0
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-workspaces-dto@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-email@0.2.2
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-mailer@0.1.4
  - @shipfox/node-module@0.3.2
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-outbox@0.2.3
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-tokens@0.2.1

## 4.0.0

### Patch Changes

- Updated dependencies [bbba3b7]
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/node-module@0.3.1
  - @shipfox/node-outbox@0.2.2

## 3.0.0

### Patch Changes

- Updated dependencies [3976f8c]
- Updated dependencies [7a71e7d]
  - @shipfox/node-module@0.3.0
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/node-fastify@0.2.2
  - @shipfox/node-mailer@0.1.3
  - @shipfox/api-auth-context@3.0.0

## 2.0.0

### Minor Changes

- c31a7e0: Adds public auth session and cookie composition APIs with password-less user and idempotent membership provisioning.
- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [0cd6dd4]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-module@0.2.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-workspaces-dto@2.0.0
  - @shipfox/node-tokens@0.2.0
  - @shipfox/config@1.2.1
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-email@0.2.1
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-mailer@0.1.2
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-outbox@0.2.1
  - @shipfox/node-postgres@0.4.1

## 0.1.2

### Patch Changes

- Updated dependencies [705dd43]
  - @shipfox/node-outbox@0.2.0
  - @shipfox/node-module@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/node-module@0.1.1
  - @shipfox/node-outbox@0.1.1

## 0.1.0

### Minor Changes

- a81b68c: Adds provisioner token and auth context primitives for workspace-scoped control-plane credentials.

### Patch Changes

- d02c5fd: Queues auth and workspace transactional emails through module-owned outbox events so account verification, password reset, and invitation sends retry outside request transactions.
- 72ce351: Removes the legacy workspace API-key auth surface, its DTOs, project-access branch, database table, and token prefix support.
- 82d22e4: Make the workspace-membership gate stateless. `requireWorkspaceAccess` now lives in `@shipfox/api-auth-context` and authorizes a request purely from the verified session-token claims, replacing the `requireMembership` gate in `@shipfox/api-workspaces` that read the workspace row from the database on every workspace-scoped request. Membership and role already travel in the token, so the check needs no database access.

  This removes the per-request database read and severs the runtime dependency on `@shipfox/api-workspaces` from feature modules that only needed the membership gate (integration providers, secrets, projects, agent, runners). Workspace existence and `active`-status enforcement, which no code path currently exercises, moves off the hot path; enforce it at token issuance when workspace suspension is introduced.

- 27770eb: Tightens signup, workspace, and project display-name validation with shared trimming, control and format-character rejection, length limits, and contextual client form errors.
- Updated dependencies [cdd8931]
- Updated dependencies [34ba284]
- Updated dependencies [5707d6d]
- Updated dependencies [b9c3f32]
- Updated dependencies [d02c5fd]
- Updated dependencies [a81b68c]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [7b175f5]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [f92122b]
- Updated dependencies [857fd73]
- Updated dependencies [75520ff]
- Updated dependencies [4798517]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [3bea87f]
- Updated dependencies [82d22e4]
- Updated dependencies [27770eb]
- Updated dependencies [6181819]
- Updated dependencies [9c149d1]
  - @shipfox/node-email@0.2.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-workspaces-dto@0.1.0
  - @shipfox/node-tokens@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/node-mailer@0.1.1
  - @shipfox/config@1.2.0
