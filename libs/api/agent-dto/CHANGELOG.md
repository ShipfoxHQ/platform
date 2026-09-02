# @shipfox/api-agent-dto

## 20.1.0

### Minor Changes

- 3ec04b0: Exposes integration tools with consistent namespaced MCP names across gateway and runner transports.

## 20.0.0

### Patch Changes

- Updated dependencies [46ae6a8]
  - @shipfox/workflow-document@3.4.0

## 19.0.0

### Patch Changes

- c07c8e2: Preserves the pinned agent harness across workflow reruns.
- b416c4c: Preserves existing package behavior while simplifying internal control flow.
- Updated dependencies [b416c4c]
  - @shipfox/workflow-document@3.3.2
  - @shipfox/inter-module@0.2.3

## 18.0.0

### Minor Changes

- a6f242c: Applies each workspace's configured default harness when checking harness-specific tools, thinking, models, and shared sessions. Managed-inference workspaces using Pi can use Pi tool names without declaring the harness.

## 17.1.0

### Minor Changes

- fd6cee5: Allows managed catalog models to declare an optional `claudeModelId` for the Claude harness.
  Runtime resolution keeps the catalog model ID when the field is absent.

## 17.0.0

### Major Changes

- 9f898d9: Replaces the logs-only `LOG_STORAGE_S3_*` base configuration with shared `OBJECT_STORAGE_S3_*` settings, per-consumer prefixes, and optional overrides, and adds encrypted agent-session transcript persistence. Self-hosters must migrate their S3 settings and provide `AGENT_SESSION_ENCRYPTION_KEK`; the DTO packages receive matching major versions for the API package-family release without DTO schema changes.

### Minor Changes

- ed4981e: Adds the lease-authed agent session transcript transport: `GET /runs/jobs/current/steps/:stepId/session` returns the decrypted, still-gzipped head snapshot with manifest headers (or a 204 no-head marker), and `POST .../session?attempt=N&base_segment=S` commits segment `S + 1` under the claim/base CAS with idempotent-retry acks and 409 conflicts. The routes resolve the leased step through a new workflows inter-module method (`getLeasedAgentSessionContext`); the artifact store enforces the session blob cap.

### Patch Changes

- be5fb95: Upgrade Pi to 0.84.2, refresh its supported provider catalog and flagship defaults, expose current direct Anthropic models to the Claude harness, and allow Pi workflow steps to use `thinking: max`.
- Updated dependencies [9fdba44]
- Updated dependencies [be5fb95]
  - @shipfox/workflow-document@3.3.1

## 16.1.0

### Minor Changes

- d1fb0a3: Adds the agent session claim and carry-over inter-module methods (`claimSession`, `carryOverSessions`) with the session descriptor (`id`, `key`, `mode`, `segment`), so workflows can resume or fork a session and rerun attempts can carry sessions forward.

  Session claims are released automatically on step-attempt and job termination, with a stale-claim reap cron as a backstop.

  The previously required `jobLeaseTokenTtlSeconds` option on `createAgentModule` is removed; pass an optional `workflows` client to enable the job-terminated grace sweep.

### Patch Changes

- c1e5dfd: Rejects the per-step `claude` runtime block when attached to reserved model provider ids such as `anthropic`; the block is only accepted alongside a managed (non-reserved) provider id.

## 16.0.0

### Major Changes

- 03e03c7: Defines managed-provider `baseUrl` as a gateway mount root and normalizes it
  for client requests. Providers that previously returned client-ready bases must
  migrate to return the gateway root before upgrading.

### Patch Changes

- Updated dependencies [117edfd]
  - @shipfox/workflow-document@3.3.0

## 15.0.0

### Minor Changes

- 07410fe: Preserves Pi thinking-level mappings and provider compatibility metadata for managed models, so gateway-backed custom providers retain their model-specific reasoning behavior.
- 989eb11: Adds `managed_provider_id` and `instance_default_provider_id` to the model-provider catalog response so clients can detect when an installation provides inference and omit redundant provider setup.

### Patch Changes

- Updated dependencies [0b6addb]
  - @shipfox/workflow-document@3.2.0

## 14.0.0

### Minor Changes

- 09924ca: Adds optional model metadata (`context_window`, `max_output_tokens`, `reasoning`, `input_image`) to managed model entries and passes it through to the pi `custom_provider` contract so managed steps carry the same model descriptor as custom providers.

### Patch Changes

- Updated dependencies [4f30864]
  - @shipfox/workflow-document@3.1.0

## 13.1.0

### Minor Changes

- 0d3c2e3: Updates @shipfox/client-agent, @shipfox/client-onboarding, and @shipfox/client-workflows to show
  managed inference providers without exposing workspace credential setup, keep workflow examples
  limited to supported models, and explain managed-provider failures in workflow runs.
- 5c100d6: Adds support for injecting a managed hosted-inference model provider into agent configuration, with harness-compatible models and instance overrides taking precedence.
- ca91dc3: Adds managed-provider runtime credential resolution and lease-scoped wire fields for pi and Claude harnesses.
- 67aab38: Adds an instance policy that can restrict workspace model-provider configuration to an injected managed provider.

## 12.2.0

### Patch Changes

- Updated dependencies [ce0984d]
  - @shipfox/workflow-document@3.0.1

## 12.0.0

### Minor Changes

- ee2ce67: Accept a `${{ }}` interpolation in an agent step's `thinking` field. The schema
  still offers the per-harness enum for editor completion, and the dispatcher
  checks the resolved value against the harness levels. An unsupported
  resolved level fails the step.
- 28daafe: Validate literal agent model and provider values during workflow authoring.

### Patch Changes

- Updated dependencies [ee2ce67]
- Updated dependencies [e95fdf4]
- Updated dependencies [f78740d]
- Updated dependencies [adf07e7]
- Updated dependencies [3f781ee]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [7f90b0c]
  - @shipfox/workflow-document@3.0.0
  - @shipfox/inter-module@0.2.3

## 10.0.0

### Patch Changes

- 43ce975: Align Pi harness compatibility and provider catalog metadata with the current Pi SDK.
  - @shipfox/inter-module@0.2.2
  - @shipfox/workflow-document@2.1.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/inter-module@0.2.2
  - @shipfox/workflow-document@2.1.3

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
  - @shipfox/workflow-document@2.1.2
  - @shipfox/inter-module@0.2.1

## 9.0.0

### Major Changes

- 46aa52f: Closes remaining API package-boundary exceptions and moves model-provider policy behind the Agent implementation boundary.

### Patch Changes

- @shipfox/inter-module@0.2.0
- @shipfox/workflow-document@2.1.1

## 8.0.0

### Minor Changes

- de559bb: Moves Agent validation policy behind a versioned inter-module catalog and injects it into Definitions normalization.

## 6.0.0

### Minor Changes

- 0bb82a4: Adds the Agent and Integrations inter-module APIs, moving Workflows agent configuration, runtime credential resolution, and integration consumers behind producer-owned clients.

### Patch Changes

- Updated dependencies [81f9544]
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/workflow-document@2.1.1

## 3.0.0

### Patch Changes

- Updated dependencies [7ce5c9e]
  - @shipfox/workflow-document@2.1.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/workflow-document@2.0.1

## 0.1.0

### Minor Changes

- 067a260: Adds workspace model provider settings for configuring, testing, defaulting, and deleting provider credentials.
- de54da2: Adds model provider catalog and provider configuration DTO contracts for backend-managed agent credentials.
- 7ca4c65: Adds step-level agent tool selection to the workflow document contract with shared harness tool deployment helpers.
- 5bcdbf4: Adds harness-native agent tool catalogs with deployment-aware Pi optional tool package config.

### Patch Changes

- aca162b: Add workspace model provider management routes: list provider catalog, list workspace provider configs, test-and-save (upsert) a provider configuration, hard-delete a configuration (clearing the workspace default when needed), and set the workspace default provider. Routes carry per-route error translation and never expose stored credentials.
- 282e66a: Exposes frozen agent integration tool selections as non-secret MCP server descriptors in materialized step config.
- Updated dependencies [eb40964]
- Updated dependencies [e7b01dd]
- Updated dependencies [9086e65]
- Updated dependencies [7ca4c65]
- Updated dependencies [e9056c7]
- Updated dependencies [8e9c6cb]
- Updated dependencies [b525dcd]
- Updated dependencies [3afb7e3]
- Updated dependencies [eb7d5e8]
- Updated dependencies [e87731a]
- Updated dependencies [f85b223]
- Updated dependencies [f0afdf8]
- Updated dependencies [69d02e5]
- Updated dependencies [f63c6b0]
- Updated dependencies [9a5aac4]
- Updated dependencies [30d1c82]
- Updated dependencies [ef1e917]
- Updated dependencies [a314b05]
- Updated dependencies [f88aac9]
- Updated dependencies [a856155]
- Updated dependencies [78527ce]
  - @shipfox/workflow-document@2.0.0
