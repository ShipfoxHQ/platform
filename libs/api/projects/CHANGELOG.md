# @shipfox/api-projects

## 20.0.0

### Minor Changes

- 533b968: Adds a paginated Projects contract for project repositories bound to a source connection.

### Patch Changes

- ec39327: Projects checkout resolution now requires a project ID and no longer accepts repository names. Checkout requests authorize the repository target before issuing credentials. Repository declarations remain valid without a project association.
- Updated dependencies [9113421]
- Updated dependencies [db83e6c]
- Updated dependencies [ec39327]
- Updated dependencies [533b968]
- Updated dependencies [351f02c]
  - @shipfox/api-auth-dto@20.0.0
  - @shipfox/api-integration-core-dto@20.0.0
  - @shipfox/api-projects-dto@20.0.0
  - @shipfox/api-auth-context@20.0.0

## 19.0.0

### Minor Changes

- 5af8d52: Adds project catalog and workflow-definition reads, plus trigger-event summaries, details, and facets.
- a225bf8: Adds a case-insensitive project lookup contract for source repository owner and name.

### Patch Changes

- b416c4c: Preserves existing package behavior while simplifying internal control flow.
- Updated dependencies [b416c4c]
- Updated dependencies [5af8d52]
- Updated dependencies [a52cd6d]
- Updated dependencies [a225bf8]
- Updated dependencies [75a54d1]
- Updated dependencies [621108c]
  - @shipfox/api-auth-context@19.0.0
  - @shipfox/api-integration-core-dto@19.0.0
  - @shipfox/node-module@1.0.8
  - @shipfox/node-outbox@0.2.7
  - @shipfox/api-projects-dto@19.0.0
  - @shipfox/api-auth-dto@19.0.0
  - @shipfox/api-common-dto@15.0.0
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-fastify@0.4.3
  - @shipfox/node-opentelemetry@0.6.5
  - @shipfox/node-postgres@0.5.1
  - @shipfox/node-temporal@0.4.6

## 18.0.0

### Patch Changes

- Updated dependencies [fff528a]
- Updated dependencies [b2aad90]
  - @shipfox/api-auth-dto@18.0.0
  - @shipfox/api-integration-core-dto@18.0.0
  - @shipfox/api-auth-context@18.0.0

## 17.0.0

### Minor Changes

- a4f56ff: Adds the `requireAdministrationActor` guard to `@shipfox/api-auth-context`. The guard rejects impersonated sessions (`UserContext` carrying `impersonatorId`) with the `admin-role-required` failure on every `/admin` route in the auth, projects, workspaces, and runners modules. It protects the first-owner bootstrap route before the system checks roles.

### Patch Changes

- Updated dependencies [a4f56ff]
- Updated dependencies [5ae8b3d]
- Updated dependencies [a591e8a]
- Updated dependencies [918d84a]
- Updated dependencies [9f898d9]
  - @shipfox/api-auth-context@17.0.0
  - @shipfox/api-auth-dto@17.0.0
  - @shipfox/node-postgres@0.5.1
  - @shipfox/node-outbox@0.2.6

## 16.0.0

### Patch Changes

- Updated dependencies [568c90b]
  - @shipfox/api-integration-core-dto@16.0.0

## 15.0.0

### Patch Changes

- @shipfox/api-common-dto@15.0.0
- @shipfox/api-integration-core-dto@15.0.0
- @shipfox/node-opentelemetry@0.6.5
- @shipfox/api-auth-dto@15.0.0
- @shipfox/api-projects-dto@15.0.0
- @shipfox/node-fastify@0.4.3
- @shipfox/node-module@1.0.7
- @shipfox/node-temporal@0.4.6
- @shipfox/api-auth-context@15.0.0

## 14.0.0

### Patch Changes

- Updated dependencies [18e9bad]
- Updated dependencies [a4df8d9]
- Updated dependencies [c44641f]
- Updated dependencies [1b71a66]
  - @shipfox/api-integration-core-dto@14.0.0
  - @shipfox/api-projects-dto@14.0.0

## 12.2.0

### Patch Changes

- 7901a60: Retry workspace workflow definition syncs when an integration connection becomes available.
- Updated dependencies [7901a60]
  - @shipfox/api-integration-core-dto@12.2.0
  - @shipfox/api-projects-dto@12.2.0
  - @shipfox/node-opentelemetry@0.6.4
  - @shipfox/node-fastify@0.4.2
  - @shipfox/node-module@1.0.6
  - @shipfox/node-temporal@0.4.5
  - @shipfox/api-auth-context@12.2.0

## 12.0.0

### Major Changes

- 4eb18b8: Add required, workspace-scoped project slugs across the API and project creation form.

### Minor Changes

- 8cc5a36: Add a `resolveCheckoutTarget` inter-module method. It resolves a project by ID
  or by owner and repository within a workspace for callers that authorize a
  checkout target.
- cb0abfa: Expose the normalized trigger project, repository, ref, and commit in workflow context.

### Patch Changes

- e405e92: Move client routes to slug-based `/w/$workspaceSlug` and `/p/$projectSlug` URLs, enforce the new composition contract, and support bounded project-slug resolution.
- 869a792: Refresh source-backed project repository identity from GitHub repository and installation-repository events.
- a0a02cc: Store normalized repository identity on source-backed projects.
- Updated dependencies [f78740d]
- Updated dependencies [4eb18b8]
- Updated dependencies [f13e8bb]
- Updated dependencies [869a792]
- Updated dependencies [8cc5a36]
- Updated dependencies [34a5639]
- Updated dependencies [032d316]
- Updated dependencies [54c820e]
- Updated dependencies [cb0abfa]
  - @shipfox/api-auth-dto@12.0.0
  - @shipfox/api-common-dto@12.0.0
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-fastify@0.4.1
  - @shipfox/node-module@1.0.5
  - @shipfox/api-projects-dto@12.0.0
  - @shipfox/api-integration-core-dto@12.0.0
  - @shipfox/node-postgres@0.5.0
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-outbox@0.2.6

## 11.0.0

### Patch Changes

- Updated dependencies [25158c8]
  - @shipfox/api-auth-context@11.0.0

## 10.2.0

### Patch Changes

- Updated dependencies [95d1456]
- Updated dependencies [0773b85]
  - @shipfox/api-auth-dto@10.2.0
  - @shipfox/api-auth-context@10.2.0

## 10.1.0

### Minor Changes

- 88ae689: Add a bounded, administrator-authorized project summary route with redacted fields and cursor pagination.

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

- Updated dependencies [74f9e31]
- Updated dependencies [e9280fc]
  - @shipfox/node-fastify@0.4.0
  - @shipfox/api-projects-dto@10.0.0
  - @shipfox/api-auth-context@10.0.0
  - @shipfox/node-module@1.0.4
  - @shipfox/api-integration-core-dto@9.0.2
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-postgres@0.4.4
  - @shipfox/node-temporal@0.4.4

## 9.3.0

### Patch Changes

- Updated dependencies [4425c6d]
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/api-auth-context@9.3.0
  - @shipfox/node-fastify@0.3.4
  - @shipfox/node-module@1.0.3
  - @shipfox/node-temporal@0.4.4

## 9.2.0

### Patch Changes

- @shipfox/api-projects-dto@9.2.0
- @shipfox/api-auth-context@9.2.0

## 9.0.3

### Patch Changes

- @shipfox/node-fastify@0.3.3
- @shipfox/node-module@1.0.2
- @shipfox/node-temporal@0.4.3
- @shipfox/api-auth-context@9.0.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-auth-context@9.0.2
  - @shipfox/api-integration-core-dto@9.0.2
  - @shipfox/api-projects-dto@9.0.2
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-fastify@0.3.2
  - @shipfox/node-module@1.0.1
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-postgres@0.4.4
  - @shipfox/node-temporal@0.4.2

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
- Updated dependencies [154e03f]
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/api-integration-core-dto@9.0.1
  - @shipfox/api-projects-dto@9.0.1
  - @shipfox/inter-module@0.2.1
  - @shipfox/node-drizzle@0.3.3
  - @shipfox/node-fastify@0.3.1
  - @shipfox/node-module@1.0.0
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-outbox@0.2.5
  - @shipfox/node-postgres@0.4.3
  - @shipfox/node-temporal@0.4.1

## 9.0.0

### Patch Changes

- Updated dependencies [02974d6]
- Updated dependencies [4a6d124]
  - @shipfox/api-integration-core-dto@9.0.0
  - @shipfox/api-auth-context@9.0.0
  - @shipfox/api-projects-dto@8.0.0
  - @shipfox/inter-module@0.2.0
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-outbox@0.2.4
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-temporal@0.4.0

## 8.0.0

### Patch Changes

- Updated dependencies [7f227c6]
  - @shipfox/api-integration-core-dto@8.0.0
  - @shipfox/api-projects-dto@8.0.0

## 7.1.0

### Patch Changes

- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-temporal@0.4.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/api-auth-context@7.1.0

## 6.0.0

### Patch Changes

- 0bb82a4: Adds the Agent and Integrations inter-module APIs, moving Workflows agent configuration, runtime credential resolution, and integration consumers behind producer-owned clients.
- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- Updated dependencies [0bb82a4]
- Updated dependencies [54ce48b]
- Updated dependencies [f4bc2eb]
- Updated dependencies [c0162b0]
- Updated dependencies [7ac43a4]
- Updated dependencies [f262539]
- Updated dependencies [a01e917]
- Updated dependencies [3bb4e26]
- Updated dependencies [8bdc149]
- Updated dependencies [3810996]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [81f9544]
- Updated dependencies [4604a06]
  - @shipfox/api-integration-core-dto@6.0.0
  - @shipfox/node-module@0.4.0
  - @shipfox/node-temporal@0.3.2
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-outbox@0.2.4
  - @shipfox/api-auth-context@6.0.0
  - @shipfox/node-fastify@0.2.4
  - @shipfox/inter-module@0.2.0
  - @shipfox/api-projects-dto@6.0.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [2875241]
- Updated dependencies [bb037af]
- Updated dependencies [fb70438]
  - @shipfox/api-integration-core@5.0.0
  - @shipfox/api-integration-core-dto@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-projects-dto@5.0.0
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-module@0.3.2
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-outbox@0.2.3
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-temporal@0.3.1

## 4.0.0

### Patch Changes

- Updated dependencies [5d129d6]
- Updated dependencies [67176d4]
- Updated dependencies [bbba3b7]
- Updated dependencies [1951293]
  - @shipfox/api-integration-core@4.0.0
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/node-module@0.3.1
  - @shipfox/node-outbox@0.2.2

## 3.0.0

### Patch Changes

- 7a71e7d: Aligns published dependency ranges with the workspace catalog policy.
- 08fc93b: Adds prebuilt production Temporal workflow bundles to API packages and removes runtime workflow compilation.
- Updated dependencies [3976f8c]
- Updated dependencies [6b23868]
- Updated dependencies [c5ee18f]
- Updated dependencies [7a71e7d]
- Updated dependencies [08fc93b]
  - @shipfox/node-module@0.3.0
  - @shipfox/api-integration-core-dto@3.0.0
  - @shipfox/node-temporal@0.3.0
  - @shipfox/api-integration-core@3.0.0
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/node-fastify@0.2.2
  - @shipfox/api-auth-context@3.0.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [0cd6dd4]
- Updated dependencies [a68458a]
- Updated dependencies [6eba800]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-module@0.2.0
  - @shipfox/api-integration-core@2.0.0
  - @shipfox/node-temporal@0.2.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-integration-core-dto@2.0.0
  - @shipfox/api-projects-dto@2.0.0
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-outbox@0.2.1
  - @shipfox/node-postgres@0.4.1

## 0.1.2

### Patch Changes

- Updated dependencies [705dd43]
  - @shipfox/node-outbox@0.2.0
  - @shipfox/api-integration-core@0.1.2
  - @shipfox/node-module@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/api-integration-core@0.1.1
  - @shipfox/node-module@0.1.1
  - @shipfox/node-outbox@0.1.1

## 0.1.0

### Minor Changes

- 43fd0c1: Adds HTTP-first E2E project setup contracts and routes for creating synthetic projects without source-control setup.

### Patch Changes

- 115655e: Moves source-event translation to the integration module: source-control providers emit a typed, provider-agnostic `INTEGRATION_SOURCE_COMMIT_PUSHED` event via one transactional publisher, projects subscribes to it instead of decoding GitHub payloads, and branch-deletion pushes are dropped at the source.
- 72ce351: Removes the legacy workspace API-key auth surface, its DTOs, project-access branch, database table, and token prefix support.
- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- 3bea87f: Adds a typed `subscriberFactory` that binds each outbox event name to its payload type at construction, so subscriber handlers receive a typed `(payload, event)` and the per-handler `event.payload as X` casts are gone; a private brand makes the factory the only way to build a module subscriber.
- 82d22e4: Make the workspace-membership gate stateless. `requireWorkspaceAccess` now lives in `@shipfox/api-auth-context` and authorizes a request purely from the verified session-token claims, replacing the `requireMembership` gate in `@shipfox/api-workspaces` that read the workspace row from the database on every workspace-scoped request. Membership and role already travel in the token, so the check needs no database access.

  This removes the per-request database read and severs the runtime dependency on `@shipfox/api-workspaces` from feature modules that only needed the membership gate (integration providers, secrets, projects, agent, runners). Workspace existence and `active`-status enforcement, which no code path currently exercises, moves off the hot path; enforce it at token issuance when workspace suspension is introduced.

- 8ecba0f: Adds OpenTelemetry project creation, source-commit handling, and current project-count metrics.
- 27770eb: Tightens signup, workspace, and project display-name validation with shared trimming, control and format-character rejection, length limits, and contextual client form errors.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- Updated dependencies [0948b67]
- Updated dependencies [34ba284]
- Updated dependencies [5707d6d]
- Updated dependencies [b9c3f32]
- Updated dependencies [a81b68c]
- Updated dependencies [115655e]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [a68ed61]
- Updated dependencies [ce062a9]
- Updated dependencies [7b175f5]
- Updated dependencies [f3614ae]
- Updated dependencies [f98c2be]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [d245be8]
- Updated dependencies [f92122b]
- Updated dependencies [f8f339a]
- Updated dependencies [58f51bd]
- Updated dependencies [570ac69]
- Updated dependencies [857fd73]
- Updated dependencies [444ac89]
- Updated dependencies [75520ff]
- Updated dependencies [b8e49ff]
- Updated dependencies [5b8ed32]
- Updated dependencies [417f128]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [3bea87f]
- Updated dependencies [82d22e4]
- Updated dependencies [01be723]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [43fd0c1]
- Updated dependencies [6181819]
- Updated dependencies [8b9c3e0]
- Updated dependencies [9c149d1]
  - @shipfox/api-integration-core@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-integration-core-dto@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/api-projects-dto@0.1.0
