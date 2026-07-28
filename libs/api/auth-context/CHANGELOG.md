# @shipfox/api-auth-context

## 10.2.0

### Patch Changes

- Updated dependencies [95d1456]
- Updated dependencies [0773b85]
- Updated dependencies [07e7371]
  - @shipfox/api-auth-dto@10.2.0
  - @shipfox/api-workspaces-dto@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [fb34b6a]
  - @shipfox/api-auth-dto@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [6054364]
- Updated dependencies [74f9e31]
- Updated dependencies [e9280fc]
  - @shipfox/api-auth-dto@10.0.0
  - @shipfox/node-fastify@0.4.0
  - @shipfox/api-workspaces-dto@10.0.0

## 9.3.0

### Patch Changes

- Updated dependencies [10cf63c]
- Updated dependencies [7b6a409]
  - @shipfox/api-auth-dto@9.3.0
  - @shipfox/api-workspaces-dto@9.3.0
  - @shipfox/node-fastify@0.3.4

## 9.2.0

### Patch Changes

- Updated dependencies [456c884]
  - @shipfox/api-auth-dto@9.2.0
  - @shipfox/api-workspaces-dto@9.2.0

## 9.0.3

### Patch Changes

- @shipfox/node-fastify@0.3.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-auth-dto@9.0.2
  - @shipfox/api-workspaces-dto@9.0.2
  - @shipfox/node-fastify@0.3.2

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/api-auth-dto@9.0.1
  - @shipfox/api-workspaces-dto@9.0.1
  - @shipfox/node-fastify@0.3.1

## 9.0.0

### Patch Changes

- Updated dependencies [9c9d266]
  - @shipfox/api-workspaces-dto@9.0.0
  - @shipfox/api-auth-dto@7.1.0
  - @shipfox/node-fastify@0.3.0

## 7.1.0

### Patch Changes

- Updated dependencies [ac42c96]
- Updated dependencies [769d919]
- Updated dependencies [6ce08c0]
  - @shipfox/node-fastify@0.3.0
  - @shipfox/api-auth-dto@7.1.0

## 6.0.0

### Major Changes

- 8bdc149: Adds scoped workspace and installation provisioner identities with explicit authorization boundaries.

### Minor Changes

- b00ed29: Adds runner bootstrap enrollment and isolated pre-workspace control sessions.

### Patch Changes

- Updated dependencies [e6eba5b]
- Updated dependencies [ba2e3dc]
- Updated dependencies [1b79cda]
- Updated dependencies [c2db8c3]
- Updated dependencies [112c0fa]
- Updated dependencies [8aa7cd3]
- Updated dependencies [326f4c0]
- Updated dependencies [4a91956]
  - @shipfox/api-auth-dto@6.0.0
  - @shipfox/api-workspaces-dto@6.0.0
  - @shipfox/node-fastify@0.2.4

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/api-auth-dto@5.0.0
  - @shipfox/api-workspaces-dto@5.0.0
  - @shipfox/node-fastify@0.2.3

## 3.0.0

### Patch Changes

- @shipfox/node-fastify@0.2.2

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-auth-dto@2.0.0
  - @shipfox/api-workspaces-dto@2.0.0
  - @shipfox/node-fastify@0.2.1

## 0.1.0

### Minor Changes

- a81b68c: Adds provisioner token and auth context primitives for workspace-scoped control-plane credentials.
- c0a883c: Moves the job lease capability token codec and its claims schema from the runners packages into api-auth/api-auth-dto, renaming its config to `AUTH_JOB_LEASE_TOKEN_*`, so all signed-token codecs live with authentication. Adds a shared leased-job auth context for request-scoped lease claims, and a shared `createLeaseTokenAuthMethod` (the `leased-job` auth method) registered on the auth module so any feature module can protect routes with a lease token by name.
- 6181819: Adds runner registration sessions with bounded label contracts, session-token auth, and lease-token heartbeat ownership.

### Patch Changes

- 72ce351: Removes the legacy workspace API-key auth surface, its DTOs, project-access branch, database table, and token prefix support.
- 82d22e4: Make the workspace-membership gate stateless. `requireWorkspaceAccess` now lives in `@shipfox/api-auth-context` and authorizes a request purely from the verified session-token claims, replacing the `requireMembership` gate in `@shipfox/api-workspaces` that read the workspace row from the database on every workspace-scoped request. Membership and role already travel in the token, so the check needs no database access.

  This removes the per-request database read and severs the runtime dependency on `@shipfox/api-workspaces` from feature modules that only needed the membership gate (integration providers, secrets, projects, agent, runners). Workspace existence and `active`-status enforcement, which no code path currently exercises, moves off the hot path; enforce it at token issuance when workspace suspension is introduced.

- Updated dependencies [34ba284]
- Updated dependencies [b9c3f32]
- Updated dependencies [d02c5fd]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [f92122b]
- Updated dependencies [e250c4c]
- Updated dependencies [857fd73]
- Updated dependencies [3afb7e3]
- Updated dependencies [362b3eb]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [27770eb]
- Updated dependencies [6181819]
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-auth-dto@0.1.0
  - @shipfox/api-workspaces-dto@0.1.0
