# @shipfox/api-agent

## 13.1.0

### Minor Changes

- 0d3c2e3: Updates @shipfox/client-agent, @shipfox/client-onboarding, and @shipfox/client-workflows to show
  managed inference providers without exposing workspace credential setup, keep workflow examples
  limited to supported models, and explain managed-provider failures in workflow runs.
- 5c100d6: Adds support for injecting a managed hosted-inference model provider into agent configuration, with harness-compatible models and instance overrides taking precedence.
- ca91dc3: Adds managed-provider runtime credential resolution and lease-scoped wire fields for pi and Claude harnesses.
- 67aab38: Adds an instance policy that can restrict workspace model-provider configuration to an injected managed provider.

### Patch Changes

- Updated dependencies [0d3c2e3]
- Updated dependencies [5c100d6]
- Updated dependencies [ca91dc3]
- Updated dependencies [67aab38]
  - @shipfox/api-agent-dto@13.1.0

## 12.2.0

### Patch Changes

- @shipfox/node-opentelemetry@0.6.4
- @shipfox/api-agent-dto@12.2.0
- @shipfox/node-fastify@0.4.2
- @shipfox/node-module@1.0.6
- @shipfox/api-auth-context@12.2.0

## 12.0.0

### Minor Changes

- ee2ce67: Accept a `${{ }}` interpolation in an agent step's `thinking` field. The schema
  still offers the per-harness enum for editor completion, and the dispatcher
  checks the resolved value against the harness levels. An unsupported
  resolved level fails the step.

### Patch Changes

- 28daafe: Validate literal agent model and provider values during workflow authoring.
- Updated dependencies [ee2ce67]
- Updated dependencies [f78740d]
- Updated dependencies [28daafe]
- Updated dependencies [f13e8bb]
  - @shipfox/api-agent-dto@12.0.0
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-fastify@0.4.1
  - @shipfox/node-module@1.0.5
  - @shipfox/redact@0.2.6
  - @shipfox/node-postgres@0.5.0
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/api-secrets-dto@12.0.0
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

- 43ce975: Align Pi harness compatibility and provider catalog metadata with the current Pi SDK.
- Updated dependencies [74f9e31]
- Updated dependencies [43ce975]
  - @shipfox/node-fastify@0.4.0
  - @shipfox/api-agent-dto@10.0.0
  - @shipfox/api-auth-context@10.0.0
  - @shipfox/node-module@1.0.4
  - @shipfox/api-secrets-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/redact@0.2.5
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-egress-guard@0.1.3
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-postgres@0.4.4

## 9.3.0

### Patch Changes

- Updated dependencies [4425c6d]
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/api-auth-context@9.3.0
  - @shipfox/node-fastify@0.3.4
  - @shipfox/node-module@1.0.3

## 9.2.0

### Patch Changes

- @shipfox/api-auth-context@9.2.0

## 9.0.3

### Patch Changes

- Updated dependencies [a831b32]
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-fastify@0.3.3
  - @shipfox/node-module@1.0.2
  - @shipfox/api-auth-context@9.0.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-agent-dto@9.0.2
  - @shipfox/api-auth-context@9.0.2
  - @shipfox/api-secrets-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-egress-guard@0.1.3
  - @shipfox/node-error-monitoring@0.2.2
  - @shipfox/node-fastify@0.3.2
  - @shipfox/node-module@1.0.1
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/node-postgres@0.4.4
  - @shipfox/redact@0.2.5

## 9.0.1

### Patch Changes

- 067d309: Prefixes Agent database objects in the migration baseline.
- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
- Updated dependencies [154e03f]
  - @shipfox/api-secrets-dto@9.0.1
  - @shipfox/redact@0.2.4
  - @shipfox/api-agent-dto@9.0.1
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/inter-module@0.2.1
  - @shipfox/node-drizzle@0.3.3
  - @shipfox/node-egress-guard@0.1.2
  - @shipfox/node-error-monitoring@0.2.1
  - @shipfox/node-fastify@0.3.1
  - @shipfox/node-module@1.0.0
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-postgres@0.4.3

## 9.0.0

### Minor Changes

- 46aa52f: Closes remaining API package-boundary exceptions and moves model-provider policy behind the Agent implementation boundary.

### Patch Changes

- Updated dependencies [46aa52f]
- Updated dependencies [02974d6]
  - @shipfox/api-agent-dto@9.0.0
  - @shipfox/api-secrets-dto@9.0.0
  - @shipfox/api-auth-context@9.0.0
  - @shipfox/config@1.2.2
  - @shipfox/inter-module@0.2.0
  - @shipfox/redact@0.2.3
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-egress-guard@0.1.1
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-postgres@0.4.2

## 8.0.0

### Patch Changes

- de559bb: Moves Agent validation policy behind a versioned inter-module catalog and injects it into Definitions normalization.
- Updated dependencies [de559bb]
  - @shipfox/api-agent-dto@8.0.0

## 7.1.0

### Patch Changes

- ac42c96: Adds boundary-owned reporting for unexpected API runtime failures while preserving expected client and provider outcomes.
- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/api-auth-context@7.1.0

## 6.0.0

### Minor Changes

- a42b575: Exposes Secrets through its inter-module contract and migrates Agent, integrations, and Workflows consumers.

### Patch Changes

- 0bb82a4: Adds the Agent and Integrations inter-module APIs, moving Workflows agent configuration, runtime credential resolution, and integration consumers behind producer-owned clients.
- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- Updated dependencies [0bb82a4]
- Updated dependencies [54ce48b]
- Updated dependencies [c0162b0]
- Updated dependencies [7ac43a4]
- Updated dependencies [a01e917]
- Updated dependencies [a42b575]
- Updated dependencies [8bdc149]
- Updated dependencies [3810996]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [81f9544]
  - @shipfox/api-agent-dto@6.0.0
  - @shipfox/node-module@0.4.0
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/redact@0.2.3
  - @shipfox/api-secrets-dto@6.0.0
  - @shipfox/api-auth-context@6.0.0
  - @shipfox/node-fastify@0.2.4
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/api-agent-dto@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-secrets@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-egress-guard@0.1.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-module@0.3.2
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-postgres@0.4.2
  - @shipfox/redact@0.2.2

## 4.0.0

### Patch Changes

- Updated dependencies [bbba3b7]
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-secrets@4.0.0
  - @shipfox/node-module@0.3.1

## 3.0.0

### Patch Changes

- 7a71e7d: Aligns published dependency ranges with the workspace catalog policy.
- Updated dependencies [3976f8c]
- Updated dependencies [7a71e7d]
  - @shipfox/node-module@0.3.0
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/api-secrets@3.0.0
  - @shipfox/api-agent-dto@3.0.0
  - @shipfox/node-fastify@0.2.2
  - @shipfox/api-auth-context@3.0.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [0cd6dd4]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-module@0.2.0
  - @shipfox/api-agent-dto@2.0.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-secrets@2.0.0
  - @shipfox/node-egress-guard@0.1.0
  - @shipfox/config@1.2.1
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-postgres@0.4.1
  - @shipfox/redact@0.2.1

## 0.1.2

### Patch Changes

- @shipfox/api-secrets@0.1.2
- @shipfox/node-module@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [68b8d03]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/redact@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/api-secrets@0.1.1
  - @shipfox/node-module@0.1.1

## 0.1.0

### Minor Changes

- 0a6318f: Adds backend model provider storage with workspace defaults and Pi catalog registry validation.
- 067a260: Adds workspace model provider settings for configuring, testing, defaulting, and deleting provider credentials.
- 5bcdbf4: Adds harness-native agent tool catalogs with deployment-aware Pi optional tool package config.

### Patch Changes

- 5cdfc69: Adds a reusable custom-model-provider egress guard with instance config for private-network and host-denylist policy.
- b1f57d1: Moves agent model provider credentials onto the shared secrets store while keeping provider config metadata and runtime resolution behavior intact.
- 97162dd: Resolves model provider, model, and thinking defaults at workflow run creation using workspace and instance configuration.
- aca162b: Add workspace model provider management routes: list provider catalog, list workspace provider configs, test-and-save (upsert) a provider configuration, hard-delete a configuration (clearing the workspace default when needed), and set the workspace default provider. Routes carry per-route error translation and never expose stored credentials.
- 82d22e4: Make the workspace-membership gate stateless. `requireWorkspaceAccess` now lives in `@shipfox/api-auth-context` and authorizes a request purely from the verified session-token claims, replacing the `requireMembership` gate in `@shipfox/api-workspaces` that read the workspace row from the database on every workspace-scoped request. Membership and role already travel in the token, so the check needs no database access.

  This removes the per-request database read and severs the runtime dependency on `@shipfox/api-workspaces` from feature modules that only needed the membership gate (integration providers, secrets, projects, agent, runners). Workspace existence and `active`-status enforcement, which no code path currently exercises, moves off the hot path; enforce it at token issuance when workspace suspension is introduced.

- Updated dependencies [067a260]
- Updated dependencies [34ba284]
- Updated dependencies [3b45d86]
- Updated dependencies [5707d6d]
- Updated dependencies [b9c3f32]
- Updated dependencies [a81b68c]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [de54da2]
- Updated dependencies [7b175f5]
- Updated dependencies [7ca4c65]
- Updated dependencies [5bcdbf4]
- Updated dependencies [ae7a63c]
- Updated dependencies [f92122b]
- Updated dependencies [360d06d]
- Updated dependencies [f8f339a]
- Updated dependencies [857fd73]
- Updated dependencies [aca162b]
- Updated dependencies [75520ff]
- Updated dependencies [f66f606]
- Updated dependencies [e51d464]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [3bea87f]
- Updated dependencies [82d22e4]
- Updated dependencies [6181819]
- Updated dependencies [3ddde91]
- Updated dependencies [282e66a]
- Updated dependencies [9c149d1]
  - @shipfox/api-agent-dto@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-secrets@0.1.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-module@0.1.0
  - @shipfox/redact@0.1.0
  - @shipfox/config@1.2.0
  - @shipfox/node-egress-guard@0.0.0
