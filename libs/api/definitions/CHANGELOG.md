# @shipfox/api-definitions

## 13.1.0

### Patch Changes

- Updated dependencies [0d3c2e3]
- Updated dependencies [5c100d6]
- Updated dependencies [ca91dc3]
- Updated dependencies [67aab38]
  - @shipfox/api-agent-dto@13.1.0

## 12.3.0

### Patch Changes

- Updated dependencies [3e7fe76]
  - @shipfox/expression@2.2.0
  - @shipfox/api-definitions-dto@12.3.0

## 12.2.0

### Minor Changes

- ce0984d: Preserve structured values when jobs map typed step outputs, normalize them for JSON persistence, and bound materialized job output sizes and entry counts.

### Patch Changes

- 7901a60: Retry workspace workflow definition syncs when an integration connection becomes available.
- Updated dependencies [7901a60]
- Updated dependencies [df2ed79]
- Updated dependencies [ce0984d]
  - @shipfox/api-integration-core-dto@12.2.0
  - @shipfox/api-projects-dto@12.2.0
  - @shipfox/runner-labels@0.2.0
  - @shipfox/expression@2.1.0
  - @shipfox/workflow-document@3.0.1
  - @shipfox/node-opentelemetry@0.6.4
  - @shipfox/api-definitions-dto@12.2.0
  - @shipfox/api-agent-dto@12.2.0
  - @shipfox/node-fastify@0.4.2
  - @shipfox/node-module@1.0.6
  - @shipfox/node-temporal@0.4.5
  - @shipfox/api-auth-context@12.2.0

## 12.0.0

### Major Changes

- 7c4116e: Align predicate property types with their runtime shapes, replace `run.run_name` with `run.workflow_name`, and remove `failed` from `executions` entries.
- adf07e7: Cut over workflow and job display names to literal-only `name` fields, with runtime interpolation supported through `run_name` and `execution_name`.

### Minor Changes

- ee2ce67: Accept a `${{ }}` interpolation in an agent step's `thinking` field. The schema
  still offers the per-harness enum for editor completion, and the dispatcher
  checks the resolved value against the harness levels. An unsupported
  resolved level fails the step.
- 5d2c9cf: Carry checkout steps from workflow normalization through step materialization and surface their setup error category.
- 3d91d1d: Allow workflow context roots in interpolatable fields while preserving host and availability validation. Keep model and provider selection restricted to workflow-authored context so external payloads and step outputs cannot steer agent execution.
- 89f2c18: Expose non-fatal definition validation warnings from the `/validate` response without
  preventing workflow synchronization. Persistence and surfacing for repo-synced definitions
  remain a follow-up.
- 045895c: Remove the unused workflow context trust metadata and related public exports. Allow
  external context in agent model and provider interpolations now that interpolation
  fields no longer enforce source tiers.
- 9e1d599: Carry first-checkout intent through workflow normalization and step materialization for the upcoming runner checkout execution, including implicit-checkout suppression, checkout opt-out, and position-based primary checkout placement.
- 3f781ee: Add workflow run and job execution naming fields to the authoring, expression, and normalized definition contracts.
- 9fdd5e4: Persist definition validation warnings from repository syncs and surface them on the workflow page without changing sync success or run creation behavior.
- 35a42bd: Resolve run and agent step working directories against the runner job workspace.
- 032d316: Scope checkout credential minting to the currently running checkout step and return its fetch depth.
- c2a8e54: Normalize checkout target fields for step-dispatch resolution, reject unsupported job-level checkout fields, and keep the workflow model and runtime checkout contracts aligned.

### Patch Changes

- 01c3dbc: Allow workflow variables in job, step, gate, and listener predicates while preserving the standard availability error for trigger filters.
- e95fdf4: Report an explicit model validation issue for checkout opt-out and checkout steps until their normalization and runtime support lands.
- 285fff2: Persist resolved workflow job execution names and handle dynamic naming failures consistently.
- 4d246d4: Align predicate validation and runtime evaluation with field-specific context contracts.
- 28daafe: Validate literal agent model and provider values during workflow authoring.
- 4444079: Warn when shell positions re-execute workflow-controlled values as code.
- Updated dependencies [ee2ce67]
- Updated dependencies [7c4116e]
- Updated dependencies [5d2c9cf]
- Updated dependencies [e95fdf4]
- Updated dependencies [3d91d1d]
- Updated dependencies [89f2c18]
- Updated dependencies [045895c]
- Updated dependencies [f78740d]
- Updated dependencies [9e1d599]
- Updated dependencies [dea1ffd]
- Updated dependencies [adf07e7]
- Updated dependencies [3f781ee]
- Updated dependencies [9fdd5e4]
- Updated dependencies [285fff2]
- Updated dependencies [4d246d4]
- Updated dependencies [4eb18b8]
- Updated dependencies [28daafe]
- Updated dependencies [f13e8bb]
- Updated dependencies [4444079]
- Updated dependencies [869a792]
- Updated dependencies [8cc5a36]
- Updated dependencies [35a42bd]
- Updated dependencies [d77baaa]
- Updated dependencies [41d558c]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [54c820e]
- Updated dependencies [cb0abfa]
- Updated dependencies [ee2ce67]
- Updated dependencies [7f90b0c]
  - @shipfox/workflow-document@3.0.0
  - @shipfox/api-definitions-dto@12.0.0
  - @shipfox/api-agent-dto@12.0.0
  - @shipfox/expression@2.0.0
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-fastify@0.4.1
  - @shipfox/node-module@1.0.5
  - @shipfox/api-projects-dto@12.0.0
  - @shipfox/api-integration-core-dto@12.0.0
  - @shipfox/node-postgres@0.5.0
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/api-secrets-dto@12.0.0
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-outbox@0.2.6

## 11.0.0

### Patch Changes

- Updated dependencies [71d9ba4]
- Updated dependencies [25158c8]
  - @shipfox/expression@1.2.1
  - @shipfox/api-auth-context@11.0.0
  - @shipfox/api-definitions-dto@11.0.0

## 10.2.0

### Patch Changes

- @shipfox/api-auth-context@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [88ae689]
  - @shipfox/api-projects-dto@10.1.0
  - @shipfox/api-auth-context@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [74f9e31]
- Updated dependencies [a713231]
- Updated dependencies [43ce975]
- Updated dependencies [e9280fc]
  - @shipfox/node-fastify@0.4.0
  - @shipfox/expression@1.2.0
  - @shipfox/api-agent-dto@10.0.0
  - @shipfox/api-projects-dto@10.0.0
  - @shipfox/api-auth-context@10.0.0
  - @shipfox/node-module@1.0.4
  - @shipfox/api-definitions-dto@10.0.0
  - @shipfox/api-integration-core-dto@9.0.2
  - @shipfox/api-secrets-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/runner-labels@0.1.3
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-postgres@0.4.4
  - @shipfox/node-temporal@0.4.4
  - @shipfox/workflow-document@2.1.3

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

## 9.1.0

### Minor Changes

- 2e9d82d: Adds a configurable repository path for workflow definition sync.

## 9.0.3

### Patch Changes

- Updated dependencies [a831b32]
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-fastify@0.3.3
  - @shipfox/node-module@1.0.2
  - @shipfox/node-temporal@0.4.3
  - @shipfox/api-auth-context@9.0.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-agent-dto@9.0.2
  - @shipfox/api-auth-context@9.0.2
  - @shipfox/api-definitions-dto@9.0.2
  - @shipfox/api-integration-core-dto@9.0.2
  - @shipfox/api-projects-dto@9.0.2
  - @shipfox/api-secrets-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/expression@1.1.5
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-error-monitoring@0.2.2
  - @shipfox/node-fastify@0.3.2
  - @shipfox/node-module@1.0.1
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-postgres@0.4.4
  - @shipfox/node-temporal@0.4.2
  - @shipfox/runner-labels@0.1.3
  - @shipfox/workflow-document@2.1.3

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
- Updated dependencies [154e03f]
  - @shipfox/api-secrets-dto@9.0.1
  - @shipfox/runner-labels@0.1.2
  - @shipfox/expression@1.1.4
  - @shipfox/workflow-document@2.1.2
  - @shipfox/api-agent-dto@9.0.1
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/api-definitions-dto@9.0.1
  - @shipfox/api-integration-core-dto@9.0.1
  - @shipfox/api-projects-dto@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/inter-module@0.2.1
  - @shipfox/node-drizzle@0.3.3
  - @shipfox/node-error-monitoring@0.2.1
  - @shipfox/node-fastify@0.3.1
  - @shipfox/node-module@1.0.0
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-outbox@0.2.5
  - @shipfox/node-postgres@0.4.3
  - @shipfox/node-temporal@0.4.1

## 9.0.0

### Patch Changes

- a9f9c57: Decouples Definitions and Workflows tests from peer implementation packages and databases.
- c279061: Improves release verification with owner-defined packed contracts, discovery-driven artifact checks, and an early publication preflight.
- Updated dependencies [46aa52f]
- Updated dependencies [02974d6]
- Updated dependencies [4a6d124]
  - @shipfox/api-agent-dto@9.0.0
  - @shipfox/api-integration-core-dto@9.0.0
  - @shipfox/api-secrets-dto@9.0.0
  - @shipfox/api-auth-context@9.0.0
  - @shipfox/api-definitions-dto@6.0.0
  - @shipfox/api-projects-dto@8.0.0
  - @shipfox/config@1.2.2
  - @shipfox/inter-module@0.2.0
  - @shipfox/runner-labels@0.1.1
  - @shipfox/expression@1.1.3
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-outbox@0.2.4
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-temporal@0.4.0
  - @shipfox/workflow-document@2.1.1

## 8.0.0

### Major Changes

- de559bb: Moves Agent validation policy behind a versioned inter-module catalog and injects it into Definitions normalization.

### Patch Changes

- Updated dependencies [de559bb]
- Updated dependencies [7f227c6]
  - @shipfox/api-agent-dto@8.0.0
  - @shipfox/api-integration-core-dto@8.0.0
  - @shipfox/api-projects-dto@8.0.0

## 7.1.0

### Patch Changes

- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-temporal@0.4.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/api-auth-context@7.1.0

## 6.0.0

### Patch Changes

- a8f0545: Adds the versioned Definitions workflow snapshot contract and registered presentation.
- 0bb82a4: Adds the Agent and Integrations inter-module APIs, moving Workflows agent configuration, runtime credential resolution, and integration consumers behind producer-owned clients.
- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- Updated dependencies [a8f0545]
- Updated dependencies [0bb82a4]
- Updated dependencies [54ce48b]
- Updated dependencies [f4bc2eb]
- Updated dependencies [c0162b0]
- Updated dependencies [7ac43a4]
- Updated dependencies [f262539]
- Updated dependencies [a01e917]
- Updated dependencies [3bb4e26]
- Updated dependencies [a42b575]
- Updated dependencies [8bdc149]
- Updated dependencies [3810996]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [81f9544]
- Updated dependencies [4604a06]
  - @shipfox/api-definitions-dto@6.0.0
  - @shipfox/api-agent-dto@6.0.0
  - @shipfox/api-integration-core-dto@6.0.0
  - @shipfox/node-module@0.4.0
  - @shipfox/node-temporal@0.3.2
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-outbox@0.2.4
  - @shipfox/api-secrets-dto@6.0.0
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
  - @shipfox/api-agent-dto@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-definitions-dto@5.0.0
  - @shipfox/api-projects@5.0.0
  - @shipfox/api-projects-dto@5.0.0
  - @shipfox/api-secrets-dto@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/expression@1.1.3
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-module@0.3.2
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-outbox@0.2.3
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-temporal@0.3.1
  - @shipfox/runner-labels@0.1.1
  - @shipfox/workflow-document@2.1.1

## 4.0.0

### Patch Changes

- Updated dependencies [5d129d6]
- Updated dependencies [67176d4]
- Updated dependencies [bbba3b7]
- Updated dependencies [1951293]
  - @shipfox/api-integration-core@4.0.0
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-projects@4.0.0
  - @shipfox/node-module@0.3.1
  - @shipfox/node-outbox@0.2.2

## 3.0.0

### Patch Changes

- 7a71e7d: Aligns published dependency ranges with the workspace catalog policy.
- 08fc93b: Adds prebuilt production Temporal workflow bundles to API packages and removes runtime workflow compilation.
- Updated dependencies [3976f8c]
- Updated dependencies [6b23868]
- Updated dependencies [7ce5c9e]
- Updated dependencies [c5ee18f]
- Updated dependencies [7a71e7d]
- Updated dependencies [08fc93b]
  - @shipfox/node-module@0.3.0
  - @shipfox/api-integration-core-dto@3.0.0
  - @shipfox/workflow-document@2.1.0
  - @shipfox/node-temporal@0.3.0
  - @shipfox/api-integration-core@3.0.0
  - @shipfox/api-projects@3.0.0
  - @shipfox/expression@1.1.2
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/api-agent-dto@3.0.0
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
  - @shipfox/api-agent-dto@2.0.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-definitions-dto@2.0.0
  - @shipfox/api-integration-core-dto@2.0.0
  - @shipfox/api-projects@2.0.0
  - @shipfox/api-projects-dto@2.0.0
  - @shipfox/api-secrets-dto@2.0.0
  - @shipfox/runner-labels@0.1.0
  - @shipfox/config@1.2.1
  - @shipfox/expression@1.1.1
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-outbox@0.2.1
  - @shipfox/node-postgres@0.4.1
  - @shipfox/workflow-document@2.0.1

## 0.1.2

### Patch Changes

- Updated dependencies [705dd43]
  - @shipfox/node-outbox@0.2.0
  - @shipfox/api-integration-core@0.1.2
  - @shipfox/api-projects@0.1.2
  - @shipfox/node-module@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/api-integration-core@0.1.1
  - @shipfox/api-projects@0.1.1
  - @shipfox/node-module@0.1.1
  - @shipfox/node-outbox@0.1.1

## 0.1.0

### Minor Changes

- 3afb7e3: Adds job execution success expressions and execution timeouts to workflow documents.
  Renames job execution IDs in auth, runner, workflow, and timeout event contracts to the explicit `jobExecutionId` / `job_execution_id` shape.
- d635979: Routes workflow materialization and predicate evaluation through persisted planner segments, replacing resolver exports with planned freeze APIs.
- 69d02e5: Adds job-level checkout permissions and persist-credentials fields to workflow documents.
- b74f635: Adds workflow run interpolation context resolution while preserving authored step configuration for reruns and diagnostics.

### Patch Changes

- eb40964: Add an inline `agent` workflow step that the runner runs with the pi harness. A step is an agent step when it carries `model` + `prompt` and no `run`; it takes a free-text `model`, a single `prompt`, and an optional `thinking` level (default `high`). The step runs to process-success (the agent ran to completion) and reports through the existing step protocol with no runner/backend protocol change, so change quality is judged by a downstream `run` + `gate` step. v1 does not persist the agent's work (no diff, commit, or PR).
- 59ba68b: Integrates workflow definitions with accepted workflow documents and normalized workflow models.
- ce062a9: Validates authored agent step integrations against provider tool catalogs and workspace connection capabilities.
- 857879a: Add a definitions-owned workflow model normalizer for accepted workflow documents.
- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- b525dcd: Let an agent workflow step pick its pi provider with an optional free-text `provider` field (default `anthropic`), threaded to the runner's pi model lookup, and split agent-step failures into a user-fixable `agent_config_invalid` reason (unknown provider, missing runner credentials, wrong provider/model pair) versus `agent_invocation_failed` for genuine provider/API errors.
- 7fa8f0b: Fix VCS sync failing when a manual definition shares a config_path. The
  `definitions_wd_project_id_config_path_unique` index was source-agnostic, so a
  manual (or validated) definition and a ref/sha-keyed VCS definition at the same
  `config_path` collided on an index that was not the VCS upsert's `ON CONFLICT`
  arbiter, raising an unhandled unique violation and breaking sync. The index (and
  the manual upsert predicate) is now scoped to manual rows so the two coexist.

  A CHECK constraint and request validation now bind `source` to its git
  coordinates (vcs rows carry a ref or sha; manual rows carry neither), so the
  index predicate's correctness is enforced rather than incidental.

- f47cff8: Add a definitions-owned workflow YAML parser that returns a shared `WorkflowDocument`.
- 795f440: Adds the listener orchestration loop for long-lived listening jobs: durable event draining, one execution per buffered event, resolution on until, listening deadline, or max executions, and a run-timeout backstop that resolves active listeners.
- 3bea87f: Adds a typed `subscriberFactory` that binds each outbox event name to its payload type at construction, so subscriber handlers receive a typed `(payload, event)` and the per-handler `event.payload as X` casts are gone; a private brand makes the factory the only way to build a module subscriber.
- fa67aa3: Reject workflow definitions whose step run/env/agent/name interpolation references a context root not yet available at that field's fill site, with a message naming when the root becomes available.
- 9a5aac4: Adds cron trigger schedule and timezone fields with source-specific document validation.
- ef1e917: Adds listening-job authoring fields and trusted execution context validation for listening jobs.
  Separates workflow identifiers so internal rows use UUID `id`, authored workflow/job/step
  references use `key`, and UI labels use `name`.
- 61de795: Adds canonical runner label validation and default runner label fallback for workflow definition parsing.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- e1d4972: Evaluate the step gate `success_if` over the `step` self-root (`step.exit_code`, `step.status`) and job `success` over the full typed executions context, both validated against the shared context registry; authored gate expressions move from `exit_code` to `step.exit_code` and job-success now fails closed on a runtime evaluation error.
- Updated dependencies [eb40964]
- Updated dependencies [7bc7498]
- Updated dependencies [067a260]
- Updated dependencies [26fea4b]
- Updated dependencies [0cf66c4]
- Updated dependencies [0948b67]
- Updated dependencies [34ba284]
- Updated dependencies [8f51daf]
- Updated dependencies [3b45d86]
- Updated dependencies [5707d6d]
- Updated dependencies [e689abf]
- Updated dependencies [59ba68b]
- Updated dependencies [ce3e5ca]
- Updated dependencies [b9c3f32]
- Updated dependencies [a81b68c]
- Updated dependencies [115655e]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [cdf8989]
- Updated dependencies [e47f8da]
- Updated dependencies [a68ed61]
- Updated dependencies [1127ba2]
- Updated dependencies [36f871d]
- Updated dependencies [e7b01dd]
- Updated dependencies [de54da2]
- Updated dependencies [d546b88]
- Updated dependencies [58c05ed]
- Updated dependencies [ce062a9]
- Updated dependencies [9086e65]
- Updated dependencies [7b175f5]
- Updated dependencies [7ca4c65]
- Updated dependencies [e9056c7]
- Updated dependencies [5bcdbf4]
- Updated dependencies [8e9c6cb]
- Updated dependencies [f3614ae]
- Updated dependencies [f98c2be]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [d245be8]
- Updated dependencies [f92122b]
- Updated dependencies [b525dcd]
- Updated dependencies [f8f339a]
- Updated dependencies [58f51bd]
- Updated dependencies [570ac69]
- Updated dependencies [857fd73]
- Updated dependencies [aca162b]
- Updated dependencies [7fa8f0b]
- Updated dependencies [998eba3]
- Updated dependencies [3afb7e3]
- Updated dependencies [444ac89]
- Updated dependencies [eb7d5e8]
- Updated dependencies [5d53ed4]
- Updated dependencies [75520ff]
- Updated dependencies [e87731a]
- Updated dependencies [f66f606]
- Updated dependencies [e51d464]
- Updated dependencies [b8e49ff]
- Updated dependencies [5b8ed32]
- Updated dependencies [417f128]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [f85b223]
- Updated dependencies [f0afdf8]
- Updated dependencies [9d3b43a]
- Updated dependencies [d635979]
- Updated dependencies [3bea87f]
- Updated dependencies [82d22e4]
- Updated dependencies [69d02e5]
- Updated dependencies [01be723]
- Updated dependencies [f63c6b0]
- Updated dependencies [e0fee57]
- Updated dependencies [fa67aa3]
- Updated dependencies [9a5aac4]
- Updated dependencies [30d1c82]
- Updated dependencies [ef1e917]
- Updated dependencies [51eb38a]
- Updated dependencies [61de795]
- Updated dependencies [e2fbef8]
- Updated dependencies [8ecba0f]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [2ad300c]
- Updated dependencies [a314b05]
- Updated dependencies [43fd0c1]
- Updated dependencies [950ebef]
- Updated dependencies [6181819]
- Updated dependencies [3ddde91]
- Updated dependencies [1ea2f6a]
- Updated dependencies [ad6056b]
- Updated dependencies [8b9c3e0]
- Updated dependencies [282e66a]
- Updated dependencies [9c149d1]
- Updated dependencies [f88aac9]
- Updated dependencies [e1d4972]
- Updated dependencies [a856155]
- Updated dependencies [78527ce]
- Updated dependencies [b8919da]
  - @shipfox/workflow-document@2.0.0
  - @shipfox/expression@1.1.0
  - @shipfox/api-agent-dto@0.1.0
  - @shipfox/api-integration-core@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-secrets-dto@0.1.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-definitions-dto@0.0.1
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-integration-core-dto@0.1.0
  - @shipfox/api-projects@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/runner-labels@0.0.1
  - @shipfox/api-projects-dto@0.1.0
  - @shipfox/config@1.2.0
