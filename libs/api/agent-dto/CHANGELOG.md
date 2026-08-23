# @shipfox/api-agent-dto

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
