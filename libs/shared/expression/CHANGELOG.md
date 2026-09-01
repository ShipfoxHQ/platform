# @shipfox/expression

## 2.4.2

### Patch Changes

- b416c4c: Preserves existing package behavior while simplifying internal control flow.
- Updated dependencies [b416c4c]
  - @shipfox/workflow-document@3.3.2

## 2.4.1

### Patch Changes

- Updated dependencies [9fdba44]
- Updated dependencies [be5fb95]
  - @shipfox/workflow-document@3.3.1

## 2.4.0

### Minor Changes

- 117edfd: Adds named agent sessions with validated keys and resume or fork modes.

### Patch Changes

- Updated dependencies [117edfd]
  - @shipfox/workflow-document@3.3.0

## 2.3.0

### Minor Changes

- b7d522a: Adds `list.first()` and `list.last()` to return the first or final element of a non-empty workflow expression list.
- 050b796: Adds typed tool-step expression contexts, result-output mappings, and reserved-root validation.

### Patch Changes

- Updated dependencies [0b6addb]
  - @shipfox/workflow-document@3.2.0

## 2.2.1

### Patch Changes

- Updated dependencies [4f30864]
  - @shipfox/workflow-document@3.1.0

## 2.2.0

### Minor Changes

- 3e7fe76: Adds shared `range()`, `toJson()`, and `fromJson()` functions to workflow expressions.

## 2.1.0

### Minor Changes

- ce0984d: Preserve structured values when jobs map typed step outputs, normalize them for JSON persistence, and bound materialized job output sizes and entry counts.

### Patch Changes

- Updated dependencies [ce0984d]
  - @shipfox/workflow-document@3.0.1

## 2.0.0

### Major Changes

- 7c4116e: Align predicate property types with their runtime shapes, replace `run.run_name` with `run.workflow_name`, and remove `failed` from `executions` entries.
- 045895c: Remove the unused workflow context trust metadata and related public exports. Allow
  external context in agent model and provider interpolations now that interpolation
  fields no longer enforce source tiers.
- adf07e7: Cut over workflow and job display names to literal-only `name` fields, with runtime interpolation supported through `run_name` and `execution_name`.
- ee2ce67: Split workflow definition facts out of the `run` context into a `workflow` root.
  `run.workflow_name` becomes `workflow.name` and `run.definition_id` becomes
  `workflow.id`, so `workflow` and `run` mirror the `job` and `execution` pair.
  Add `contextRootsForField` to return the readable roots for a predicate or an
  interpolation field without requiring the caller to choose a mechanism. Add
  `workflowContextDocs` as the reader-facing description of every root and property.

### Minor Changes

- dea1ffd: Expose normalized repository references on listening execution events.
- 3f781ee: Add workflow run and job execution naming fields to the authoring, expression, and normalized definition contracts.
- 285fff2: Persist resolved workflow job execution names and handle dynamic naming failures consistently.
- 4d246d4: Align predicate validation and runtime evaluation with field-specific context contracts.
- d77baaa: Add per-definition sequential numbers to workflow runs and expose them in the API and expression context.
- 41d558c: Add a pure shell code-position classifier for detecting workflow data passed to commands that re-evaluate their arguments.
- c2a8e54: Normalize checkout target fields for step-dispatch resolution, reject unsupported job-level checkout fields, and keep the workflow model and runtime checkout contracts aligned.
- cb0abfa: Expose the normalized trigger project, repository, ref, and commit in workflow context.

### Patch Changes

- 3d91d1d: Allow workflow context roots in interpolatable fields while preserving host and availability validation. Keep model and provider selection restricted to workflow-authored context so external payloads and step outputs cannot steer agent execution.
- 4444079: Warn when shell positions re-execute workflow-controlled values as code.
- Updated dependencies [ee2ce67]
- Updated dependencies [e95fdf4]
- Updated dependencies [adf07e7]
- Updated dependencies [3f781ee]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [7f90b0c]
  - @shipfox/workflow-document@3.0.0

## 1.2.1

### Patch Changes

- 71d9ba4: Accepts integer literals in CEL equality checks against numeric workflow values.

## 1.2.0

### Minor Changes

- a713231: Add scoped CEL environments, a per-evaluation inclusive `range` primitive capped at 1,000 values, and typed exact-expression field resolution for config templating.

### Patch Changes

- @shipfox/workflow-document@2.1.3

## 1.1.5

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/workflow-document@2.1.3

## 1.1.4

### Patch Changes

- 8436596: Adds Dependency Cruiser checks to all classified API packages so source-edge enforcement remains active after retiring the duplicate import scan.
- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
  - @shipfox/workflow-document@2.1.2

## 1.1.3

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/workflow-document@2.1.1

## 1.1.2

### Patch Changes

- 7a71e7d: Aligns published dependency ranges with the workspace catalog policy.
- Updated dependencies [7ce5c9e]
  - @shipfox/workflow-document@2.1.0

## 1.1.1

### Patch Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.
- Updated dependencies [1b0d344]
  - @shipfox/workflow-document@2.0.1

## 1.1.0

### Minor Changes

- 7bc7498: Adds job runner as a server-side interpolation field for execution-level runner selection.
- 26fea4b: Adds the authorable `steps` workflow context root and a shared field resolver for preserving residual interpolation plans.
- 0cf66c4: Adds ingest-time predicate foundations with filter predicate fields and boolean-shape detection.
- 8f51daf: Adds workflow template parsing with expression segments and conservative CEL root extraction for downstream interpolation checks.
- e689abf: Adds the v1 workflow context registry and interpolation field policies for typed, trust-tiered workflow interpolation.
- ce3e5ca: Adds residual workflow expression planning APIs for deferred field segments, runner-fill validation, server-evaluability checks, and monotone site fills.
- cdf8989: Adds shared CEL expression checks and evaluation behind Shipfox-owned APIs.
- 1127ba2: Adds safe run-command interpolation by hoisting resolved values into generated environment variables.
- 36f871d: Adds evaluation trace helpers for recording resolved workflow expressions with capped values and secret references.
- d546b88: Adds declared workflow field failure policies and a shared fail-closed predicate evaluator.
- 998eba3: Adds phase-aware workflow context metadata, availability predicates, and creation-phase workflow context assembly for runtime materialization.
- 5d53ed4: Adds workflow expression support for vars and runner-host secret contexts with literal-key validation.
- f0afdf8: Renames the step gate predicate from `success_if` to `success` and the restart payload from `on_failure.output` to `on_failure.feedback` across workflow authoring and predicate planning.
- 9d3b43a: Adds expected result type validation for typed workflow expressions.
- d635979: Routes workflow materialization and predicate evaluation through persisted planner segments, replacing resolver exports with planned freeze APIs.
- e0fee57: Promotes workflow jobs context and expands execution and step self-root expression shapes for workflow output references.
- fa67aa3: Reject workflow definitions whose step run/env/agent/name interpolation references a context root not yet available at that field's fill site, with a message naming when the root becomes available.
- ef1e917: Adds listening-job authoring fields and trusted execution context validation for listening jobs.
  Separates workflow identifiers so internal rows use UUID `id`, authored workflow/job/step
  references use `key`, and UI labels use `name`.
- 51eb38a: Adds the step.feedback interpolation field for server-side gate feedback templates.
- e2fbef8: Adds an open-map expression type so workflow predicates can type-check dynamic step output fields.
- 2ad300c: Adds typed step output coercion helpers for validating reported workflow outputs against declarations.
- a314b05: Adds workflow job output mapping support with execution-resolution interpolation planning.
- 1ea2f6a: Renames workflow context phases to availability sites, reshapes reserved roots, and adds sensitivity, host, and fill-target exports for planner context assembly.
- ad6056b: Adds workflow template resolution with string coercion, missing-path diagnostics, and typed evaluation failures.
- a856155: Adds typed workflow output declarations and expression overlays for validating downstream output references.

### Patch Changes

- e7b01dd: Adds the conditional workflow context surface and document fields for persisted if predicates.
- 58c05ed: Removes the unused resolved-field fill primitive from the expression package surface.
- 950ebef: Fixes fail-policy freezing for reserved server roots such as steps, jobs, and matrix.
- e1d4972: Evaluate the step gate `success_if` over the `step` self-root (`step.exit_code`, `step.status`) and job `success` over the full typed executions context, both validated against the shared context registry; authored gate expressions move from `exit_code` to `step.exit_code` and job-success now fails closed on a runtime evaluation error.
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
