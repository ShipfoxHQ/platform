# @shipfox/api-auth

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-auth-context@9.0.2
  - @shipfox/api-auth-dto@9.0.2
  - @shipfox/api-email-challenges@1.1.1
  - @shipfox/api-workspaces-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-auth-root-key@0.2.3
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-email@0.3.3
  - @shipfox/node-fastify@0.3.2
  - @shipfox/node-jwt@0.3.2
  - @shipfox/node-mailer@0.2.3
  - @shipfox/node-module@1.0.1
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-postgres@0.4.4
  - @shipfox/node-rate-limit@0.3.2
  - @shipfox/node-tokens@0.3.2

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [44c15c8]
- Updated dependencies [475ce59]
- Updated dependencies [154e03f]
  - @shipfox/api-email-challenges@1.1.0
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/api-auth-dto@9.0.1
  - @shipfox/api-workspaces-dto@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/inter-module@0.2.1
  - @shipfox/node-auth-root-key@0.2.2
  - @shipfox/node-drizzle@0.3.3
  - @shipfox/node-email@0.3.2
  - @shipfox/node-fastify@0.3.1
  - @shipfox/node-jwt@0.3.1
  - @shipfox/node-mailer@0.2.2
  - @shipfox/node-module@1.0.0
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-outbox@0.2.5
  - @shipfox/node-postgres@0.4.3
  - @shipfox/node-rate-limit@0.3.1
  - @shipfox/node-tokens@0.3.1

## 9.0.0

### Patch Changes

- Updated dependencies [9c9d266]
- Updated dependencies [c279061]
- Updated dependencies [9083d20]
  - @shipfox/api-workspaces-dto@9.0.0
  - @shipfox/api-email-challenges@1.0.0
  - @shipfox/api-auth-context@9.0.0
  - @shipfox/api-auth-dto@7.1.0
  - @shipfox/config@1.2.2
  - @shipfox/inter-module@0.2.0
  - @shipfox/node-auth-root-key@0.2.1
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-email@0.3.1
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-jwt@0.3.0
  - @shipfox/node-mailer@0.2.1
  - @shipfox/node-module@0.5.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-outbox@0.2.4
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-rate-limit@0.3.0
  - @shipfox/node-tokens@0.3.0

## 7.1.0

### Minor Changes

- 2a7d951: Adds authenticated refresh-session context resolution with stable identity across access-token refreshes.

### Patch Changes

- Updated dependencies [ac42c96]
- Updated dependencies [769d919]
- Updated dependencies [6ce08c0]
- Updated dependencies [8bb32b2]
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/api-auth-dto@7.1.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/api-email-challenges@0.3.0
  - @shipfox/api-auth-context@7.1.0
  - @shipfox/node-mailer@0.2.1

## 7.0.2

### Patch Changes

- Updated dependencies [81c8f33]
  - @shipfox/node-auth-root-key@0.2.1
  - @shipfox/api-email-challenges@0.2.3

## 7.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/api-email-challenges@0.2.2
  - @shipfox/node-email@0.3.1

## 7.0.0

### Patch Changes

- Updated dependencies [4d7c87e]
  - @shipfox/node-email@0.3.0
  - @shipfox/api-email-challenges@0.2.1

## 6.0.0

### Major Changes

- 6a52909: Replaces separate API auth secrets with domain-separated keys derived from one required AUTH_ROOT_KEY.
- ba2e3dc: Migrates password email verification from magic links to shared eight-digit email challenges.

### Minor Changes

- 326f4c0: Exposes Workspaces inter-module operations and moves Auth and OAuth providers onto injected clients.
- 4a91956: Publishes a shared provider-neutral `emailSchema` in `@shipfox/api-common-dto` and adopts it across auth and workspace invitation inputs. Adds a read-only `findUserByEmail`/`EmailOwner` seam to `@shipfox/api-auth` for looking up the current owner of a normalized email without creating a session or mutating that user. Extends the packed external consumer gate to exercise both seams against PostgreSQL through installed tarballs.

### Patch Changes

- 7366f04: Adds a configured shared mailer that owns SMTP delivery settings. `@shipfox/api-auth` and `@shipfox/api-workspaces` drop their own mailer environment variables and factory logic and use the shared `mailer` from `@shipfox/node-mailer` instead.
- 112c0fa: Adds the Auth inter-module token-minting contract and removes Auth implementation and configuration coupling from its consumers.
- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- Updated dependencies [905b6a3]
- Updated dependencies [b70f920]
- Updated dependencies [7366f04]
- Updated dependencies [6a52909]
- Updated dependencies [e6eba5b]
- Updated dependencies [54ce48b]
- Updated dependencies [ba2e3dc]
- Updated dependencies [c0162b0]
- Updated dependencies [7ac43a4]
- Updated dependencies [a01e917]
- Updated dependencies [1b79cda]
- Updated dependencies [c2db8c3]
- Updated dependencies [112c0fa]
- Updated dependencies [8bdc149]
- Updated dependencies [3810996]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [326f4c0]
- Updated dependencies [4a91956]
- Updated dependencies [81f9544]
  - @shipfox/api-email-challenges@0.2.0
  - @shipfox/node-tokens@0.3.0
  - @shipfox/node-mailer@0.2.0
  - @shipfox/node-auth-root-key@0.2.0
  - @shipfox/node-jwt@0.3.0
  - @shipfox/node-rate-limit@0.3.0
  - @shipfox/api-auth-dto@6.0.0
  - @shipfox/node-module@0.4.0
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-outbox@0.2.4
  - @shipfox/api-workspaces-dto@6.0.0
  - @shipfox/api-auth-context@6.0.0
  - @shipfox/node-fastify@0.2.4
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-auth-dto@5.0.0
  - @shipfox/api-workspaces@5.0.0
  - @shipfox/api-workspaces-dto@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-email@0.2.2
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-jwt@0.2.1
  - @shipfox/node-mailer@0.1.4
  - @shipfox/node-module@0.3.2
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-outbox@0.2.3
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-rate-limit@0.2.1
  - @shipfox/node-tokens@0.2.1

## 4.0.0

### Patch Changes

- 0b0a9c2: Serializes real-database auth test files to prevent shared rate-limit state from causing intermittent failures.
- Updated dependencies [bbba3b7]
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-workspaces@4.0.0
  - @shipfox/node-module@0.3.1
  - @shipfox/node-outbox@0.2.2

## 3.0.0

### Minor Changes

- 3976f8c: Adds module login-method declarations, validates server compositions before startup, and adds password-login route configuration.

### Patch Changes

- Updated dependencies [3976f8c]
- Updated dependencies [7a71e7d]
  - @shipfox/node-module@0.3.0
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/api-workspaces@3.0.0
  - @shipfox/node-fastify@0.2.2
  - @shipfox/node-mailer@0.1.3
  - @shipfox/api-auth-context@3.0.0

## 2.0.0

### Minor Changes

- c31a7e0: Adds public auth session and cookie composition APIs with password-less user and idempotent membership provisioning.
- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [0cd6dd4]
- Updated dependencies [c31a7e0]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-module@0.2.0
  - @shipfox/api-workspaces@2.0.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-auth-dto@2.0.0
  - @shipfox/api-workspaces-dto@2.0.0
  - @shipfox/node-jwt@0.2.0
  - @shipfox/node-rate-limit@0.2.0
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
  - @shipfox/api-workspaces@0.1.2
  - @shipfox/node-module@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/api-workspaces@0.1.1
  - @shipfox/node-module@0.1.1
  - @shipfox/node-outbox@0.1.1

## 0.1.0

### Minor Changes

- c0a883c: Moves the job lease capability token codec and its claims schema from the runners packages into api-auth/api-auth-dto, renaming its config to `AUTH_JOB_LEASE_TOKEN_*`, so all signed-token codecs live with authentication. Adds a shared leased-job auth context for request-scoped lease claims, and a shared `createLeaseTokenAuthMethod` (the `leased-job` auth method) registered on the auth module so any feature module can protect routes with a lease token by name.
- 6181819: Adds runner registration sessions with bounded label contracts, session-token auth, and lease-token heartbeat ownership.

### Patch Changes

- d02c5fd: Queues auth and workspace transactional emails through module-owned outbox events so account verification, password reset, and invitation sends retry outside request transactions.
- e250c4c: Propagates `projectId` end-to-end into the job lease token. Workflows sources the `{workspaceId, projectId, workflowRunId, workflowRunAttemptId, jobId, jobExecutionId}` identity tuple and threads it through the runner pending/running job tables and lease claims. This is lease-shape groundwork for per-project log-ingest authorization; the stream-stamping consumer lands separately.
- b0a0e1a: Expose the auth `config` object through a new `@shipfox/api-auth/config` subpath export, so a module that already depends on auth can read auth-owned settings (such as `AUTH_JOB_LEASE_TOKEN_EXPIRES_IN`) without pulling in the full module graph from the package root.
- 1c1fb3e: Adds shared fixed-window rate limiting for provisioner token minting and ephemeral runner registration.
- 1daf39a: Tolerates concurrent refresh-token reuse within a grace window so parallel browser tabs no longer log each other out, and treats reuse past the window as a session compromise.
- 362b3eb: Scope runner log append authorization to the dispatched step attempt carried by the job lease token.
- 27770eb: Tightens signup, workspace, and project display-name validation with shared trimming, control and format-character rejection, length limits, and contextual client form errors.
- fb64f13: Extracts the HS256 sign/verify mechanics into a shared `@shipfox/node-jwt` package and refactors auth user-token signing onto it, leaving the auth public API unchanged.
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
- Updated dependencies [e250c4c]
- Updated dependencies [b0a0e1a]
- Updated dependencies [857fd73]
- Updated dependencies [1c1fb3e]
- Updated dependencies [3afb7e3]
- Updated dependencies [75520ff]
- Updated dependencies [4798517]
- Updated dependencies [362b3eb]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [3bea87f]
- Updated dependencies [82d22e4]
- Updated dependencies [27770eb]
- Updated dependencies [6181819]
- Updated dependencies [9c149d1]
- Updated dependencies [fb64f13]
  - @shipfox/node-email@0.2.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-auth-dto@0.1.0
  - @shipfox/api-workspaces-dto@0.1.0
  - @shipfox/api-workspaces@0.1.0
  - @shipfox/node-tokens@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/node-jwt@0.1.0
  - @shipfox/node-rate-limit@0.1.0
  - @shipfox/node-mailer@0.1.1
  - @shipfox/config@1.2.0
