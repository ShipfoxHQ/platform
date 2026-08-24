# @shipfox/workflow-document

## 3.3.0

### Minor Changes

- 117edfd: Adds named agent sessions with validated keys and resume or fork modes.

## 3.2.0

### Minor Changes

- 0b6addb: Adds reserved tool step fields (`tool`, `connection`, `with`, and the expression `outputs` mapping form) to the workflow document schema, with `with` size and depth limits. The schema rejects steps that use them for now.

## 3.1.0

### Minor Changes

- 4f30864: Trigger `event` is now optional end to end. An omitted event subscribes to every event from its source. Explicit events continue to work unchanged. Built-in manual and scheduled triggers use `fire` and `tick`, respectively.

## 3.0.1

### Patch Changes

- ce0984d: Preserve structured values when jobs map typed step outputs, normalize them for JSON persistence, and bound materialized job output sizes and entry counts.

## 3.0.0

### Major Changes

- adf07e7: Cut over workflow and job display names to literal-only `name` fields, with runtime interpolation supported through `run_name` and `execution_name`.

### Minor Changes

- ee2ce67: Accept a `${{ }}` interpolation in an agent step's `thinking` field. The schema
  still offers the per-harness enum for editor completion, and the dispatcher
  checks the resolved value against the harness levels. An unsupported
  resolved level fails the step.
- e95fdf4: Add checkout target fields, checkout opt-out, and checkout steps to the workflow document schema.
- 3f781ee: Add workflow run and job execution naming fields to the authoring, expression, and normalized definition contracts.
- 032d316: Scope checkout credential minting to the currently running checkout step and return its fetch depth.
- c2a8e54: Normalize checkout target fields for step-dispatch resolution, reject unsupported job-level checkout fields, and keep the workflow model and runtime checkout contracts aligned.
- 7f90b0c: Add `working_directory` to the workflow-document schema for run and agent steps.

## 2.1.3

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.

## 2.1.2

### Patch Changes

- 8436596: Adds Dependency Cruiser checks to all classified API packages so source-edge enforcement remains active after retiring the duplicate import scan.
- 475ce59: Republishes all public packages after restoring release authorization.

## 2.1.1

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 2.1.0

### Minor Changes

- 7ce5c9e: Adds generated JSON Schema metadata for Shipfox workflow documents.

## 2.0.1

### Patch Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 2.0.0

### Major Changes

- 78527ce: Removes per-integration repository allowlists from agent workflow documents.

### Minor Changes

- 9086e65: Adds agent-step integration tool selection to the workflow document schema with method-aware include and exclude shapes.
- 7ca4c65: Adds step-level agent tool selection to the workflow document contract with shared harness tool deployment helpers.
- e9056c7: Adds workflow, job, and run-step env declarations for non-secret run-step configuration.
- 8e9c6cb: Adds per-harness agent thinking schemas and exports helpers for resolving supported thinking levels by harness.
- 3afb7e3: Adds job execution success expressions and execution timeouts to workflow documents.
  Renames job execution IDs in auth, runner, workflow, and timeout event contracts to the explicit `jobExecutionId` / `job_execution_id` shape.
- eb7d5e8: Adds step gates with `success_if` and `on_failure` to the workflow document shape.
- e87731a: Adds the agent step harness selector and updates the default agent thinking level to xhigh.
- f85b223: Moves trigger source-specific authoring fields into per-source config blocks so cron triggers use `config.schedule` and `config.timezone`.
- f0afdf8: Renames the step gate predicate from `success_if` to `success` and the restart payload from `on_failure.output` to `on_failure.feedback` across workflow authoring and predicate planning.
- 69d02e5: Adds job-level checkout permissions and persist-credentials fields to workflow documents.
- f63c6b0: Adds a shared workflow document package with a Zod contract and typed invalid-document error.
- 30d1c82: Adds workflow env size limits with exported constants and author-facing validation errors.
- ef1e917: Adds listening-job authoring fields and trusted execution context validation for listening jobs.
  Separates workflow identifiers so internal rows use UUID `id`, authored workflow/job/step
  references use `key`, and UI labels use `name`.
- a314b05: Adds workflow job output mapping support with execution-resolution interpolation planning.
- f88aac9: Allows workflow agent steps to omit model, provider, and thinking while requiring only prompt.
- a856155: Adds typed workflow output declarations and expression overlays for validating downstream output references.

### Patch Changes

- eb40964: Add an inline `agent` workflow step that the runner runs with the pi harness. A step is an agent step when it carries `model` + `prompt` and no `run`; it takes a free-text `model`, a single `prompt`, and an optional `thinking` level (default `high`). The step runs to process-success (the agent ran to completion) and reports through the existing step protocol with no runner/backend protocol change, so change quality is judged by a downstream `run` + `gate` step. v1 does not persist the agent's work (no diff, commit, or PR).
- e7b01dd: Adds the conditional workflow context surface and document fields for persisted if predicates.
- b525dcd: Let an agent workflow step pick its pi provider with an optional free-text `provider` field (default `anthropic`), threaded to the runner's pi model lookup, and split agent-step failures into a user-fixable `agent_config_invalid` reason (unknown provider, missing runner credentials, wrong provider/model pair) versus `agent_invocation_failed` for genuine provider/API errors.
- 9a5aac4: Adds cron trigger schedule and timezone fields with source-specific document validation.
