# @shipfox/api-workflows

## 13.1.0

### Patch Changes

- 0d3c2e3: Updates @shipfox/client-agent, @shipfox/client-onboarding, and @shipfox/client-workflows to show
  managed inference providers without exposing workspace credential setup, keep workflow examples
  limited to supported models, and explain managed-provider failures in workflow runs.
- ca91dc3: Adds managed-provider runtime credential resolution and lease-scoped wire fields for pi and Claude harnesses.
- Updated dependencies [0d3c2e3]
- Updated dependencies [5c100d6]
- Updated dependencies [ca91dc3]
- Updated dependencies [67aab38]
  - @shipfox/api-agent-dto@13.1.0
  - @shipfox/api-workflows-dto@13.1.0

## 13.0.0

### Patch Changes

- af6b31e: Expose ordered queued and terminal workflow job-execution facts, and release terminal runner reservations once no uncancelled lease remains.
- Updated dependencies [af6b31e]
  - @shipfox/api-runners-dto@13.0.0
  - @shipfox/api-workflows-dto@13.0.0

## 12.7.0

### Minor Changes

- 4df5e37: Workflow run list items and run detail now carry `has_started_job_execution`, reporting whether any
  job execution of the attempt reached a runner. Run surfaces no longer show a client-derived `Queued`
  state: the run list and run detail present the API attempt status and duration, and read the new
  field to label a finished run's duration as run or elapsed time.

### Patch Changes

- Updated dependencies [4df5e37]
  - @shipfox/api-workflows-dto@12.7.0

## 12.6.0

### Minor Changes

- 53b87f0: Distinguish queued and executing jobs in workflow run list status strips.

### Patch Changes

- Updated dependencies [53b87f0]
  - @shipfox/api-workflows-dto@12.6.0

## 12.5.0

### Minor Changes

- 5b1838c: Expose actionable status reasons and messages when materialized job outputs cannot be persisted.

### Patch Changes

- 69940bc: Include measured output sizes and overshoots in job output size errors.
- 41f8f5f: Raises job output limits to 64 KiB per value and 256 KiB total before runner-side cap changes.
- Updated dependencies [5b1838c]
  - @shipfox/api-workflows-dto@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [9e16946]
- Updated dependencies [4fa8526]
  - @shipfox/api-runners-dto@12.4.0

## 12.3.0

### Minor Changes

- 4b0731e: Adds workflow troubleshooting details, evaluation traces, failure annotations, runner context, step output metadata, and lazy paginated annotation summaries.
- a830294: Loads configured runner catalog names when materializing workflow runner labels.

### Patch Changes

- Updated dependencies [4b0731e]
- Updated dependencies [3e7fe76]
  - @shipfox/api-workflows-dto@12.3.0
  - @shipfox/annotations-dto@12.3.0
  - @shipfox/expression@2.2.0
  - @shipfox/api-definitions-dto@12.3.0

## 12.2.0

### Minor Changes

- ce0984d: Preserve structured values when jobs map typed step outputs, normalize them for JSON persistence, and bound materialized job output sizes and entry counts.

### Patch Changes

- 214b8f2: Expose execution and run numeric fields as CEL integers, preserve zero-based execution indices,
  and keep listener filter snapshots aligned with live CEL values after persistence.
- Updated dependencies [78b771c]
- Updated dependencies [7901a60]
- Updated dependencies [df2ed79]
- Updated dependencies [ce0984d]
  - @shipfox/api-runners-dto@12.2.0
  - @shipfox/api-integration-core-dto@12.2.0
  - @shipfox/api-projects-dto@12.2.0
  - @shipfox/runner-labels@0.2.0
  - @shipfox/expression@2.1.0
  - @shipfox/api-workflows-dto@12.2.0
  - @shipfox/workflow-document@3.0.1
  - @shipfox/node-opentelemetry@0.6.4
  - @shipfox/api-definitions-dto@12.2.0
  - @shipfox/api-agent-dto@12.2.0
  - @shipfox/node-fastify@0.4.2
  - @shipfox/node-module@1.0.6
  - @shipfox/node-temporal@0.4.5
  - @shipfox/api-auth-context@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [312a137]
  - @shipfox/api-workflows-dto@12.1.0

## 12.0.0

### Major Changes

- adf07e7: Cut over workflow and job display names to literal-only `name` fields, with runtime interpolation supported through `run_name` and `execution_name`.
- 032d316: Scope checkout credential minting to the currently running checkout step and return its fetch depth.

### Minor Changes

- ee2ce67: Accept a `${{ }}` interpolation in an agent step's `thinking` field. The schema
  still offers the per-harness enum for editor completion, and the dispatcher
  checks the resolved value against the harness levels. An unsupported
  resolved level fails the step.
- 5d2c9cf: Carry checkout steps from workflow normalization through step materialization and surface their setup error category.
- f7939c7: Add resolved checkout details as a dedicated step-report field.
- 9e1d599: Carry first-checkout intent through workflow normalization and step materialization for the upcoming runner checkout execution, including implicit-checkout suppression, checkout opt-out, and position-based primary checkout placement.
- dea1ffd: Expose normalized repository references on listening execution events.
- 285fff2: Persist resolved workflow job execution names and handle dynamic naming failures consistently.
- e44a279: Persist nullable resolved workflow run-name overrides alongside static workflow-name snapshots.
- 54c820e: Add the trigger reference and the current attempt's jobs to each workflow run in the run list response.

  `trigger_reference` carries the repository, ref, commit, and actor a source-control trigger resolved, or null for triggers that resolve none. Jobs arrive as `jobs`, a preview bounded by the new `WORKFLOW_RUN_JOB_PREVIEW_LIMIT`, alongside `job_status_counts` covering every job of the attempt including those past the preview.

- 35a42bd: Resolve run and agent step working directories against the runner job workspace.
- d77baaa: Add per-definition sequential numbers to workflow runs and expose them in the API and expression context.
- c2a8e54: Normalize checkout target fields for step-dispatch resolution, reject unsupported job-level checkout fields, and keep the workflow model and runtime checkout contracts aligned.
- cb0abfa: Expose the normalized trigger project, repository, ref, and commit in workflow context.
- ee2ce67: Split workflow definition facts out of the `run` context into a `workflow` root.
  `run.workflow_name` becomes `workflow.name` and `run.definition_id` becomes
  `workflow.id`, so `workflow` and `run` mirror the `job` and `execution` pair.
  Add `contextRootsForField` to return the readable roots for a predicate or an
  interpolation field without requiring the caller to choose a mechanism. Add
  `workflowContextDocs` as the reader-facing description of every root and property.

### Patch Changes

- 7c4116e: Align predicate property types with their runtime shapes, replace `run.run_name` with `run.workflow_name`, and remove `failed` from `executions` entries.
- 0bb880a: Transition job executions from pending to running when the runner claims them.
- f78740d: Remove Unicode dash punctuation from package prose and source comments.
- 4d246d4: Align predicate validation and runtime evaluation with field-specific context contracts.
- 66f111e: Snapshots referenced workflow variables for predicate evaluation at run creation.
- 53ce6b2: Materialize primary checkout credential persistence on the setup step.
- 5d267c3: Re-materialize checkout policy from the workflow model when re-running a job.
- 9e39069: Defaults same-project checkout steps to the workflow trigger commit while preserving explicit refs and cross-repository defaults.
- Updated dependencies [ee2ce67]
- Updated dependencies [7c4116e]
- Updated dependencies [5d2c9cf]
- Updated dependencies [e95fdf4]
- Updated dependencies [3d91d1d]
- Updated dependencies [f7939c7]
- Updated dependencies [89f2c18]
- Updated dependencies [045895c]
- Updated dependencies [f78740d]
- Updated dependencies [9e1d599]
- Updated dependencies [dea1ffd]
- Updated dependencies [adf07e7]
- Updated dependencies [94aba88]
- Updated dependencies [3f781ee]
- Updated dependencies [9fdd5e4]
- Updated dependencies [285fff2]
- Updated dependencies [e44a279]
- Updated dependencies [4d246d4]
- Updated dependencies [4eb18b8]
- Updated dependencies [28daafe]
- Updated dependencies [f13e8bb]
- Updated dependencies [9ebc5b4]
- Updated dependencies [4444079]
- Updated dependencies [869a792]
- Updated dependencies [8cc5a36]
- Updated dependencies [54c820e]
- Updated dependencies [35a42bd]
- Updated dependencies [d77baaa]
- Updated dependencies [41d558c]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [54c820e]
- Updated dependencies [cb0abfa]
- Updated dependencies [ee2ce67]
- Updated dependencies [7f90b0c]
- Updated dependencies [e1efaee]
  - @shipfox/workflow-document@3.0.0
  - @shipfox/api-definitions-dto@12.0.0
  - @shipfox/api-workflows-dto@12.0.0
  - @shipfox/api-agent-dto@12.0.0
  - @shipfox/expression@2.0.0
  - @shipfox/api-auth-dto@12.0.0
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-fastify@0.4.1
  - @shipfox/node-module@1.0.5
  - @shipfox/api-workspaces-dto@12.0.0
  - @shipfox/api-projects-dto@12.0.0
  - @shipfox/api-integration-core-dto@12.0.0
  - @shipfox/node-postgres@0.5.0
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/annotations-dto@12.0.0
  - @shipfox/api-runners-dto@12.0.0
  - @shipfox/api-secrets-dto@12.0.0
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-outbox@0.2.6

## 11.0.0

### Major Changes

- 25158c8: Carry workspace lifecycle status in JWT membership claims and enforce suspended or inactive access at the stateless workspace gate while keeping access-token verification stateless.

  `getAuthenticatedSessionContext()` now reads refresh-session metadata from verified access-token claims without checking active refresh-session state; revoking a refresh session does not invalidate an already-issued access token.

### Patch Changes

- Updated dependencies [71d9ba4]
- Updated dependencies [25158c8]
  - @shipfox/expression@1.2.1
  - @shipfox/api-auth-context@11.0.0
  - @shipfox/api-workspaces-dto@11.0.0
  - @shipfox/api-definitions-dto@11.0.0

## 10.2.0

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

### Patch Changes

- Updated dependencies [6054364]
- Updated dependencies [74f9e31]
- Updated dependencies [22bf8a2]
- Updated dependencies [a713231]
- Updated dependencies [43ce975]
- Updated dependencies [e9280fc]
- Updated dependencies [837bf5d]
- Updated dependencies [3f5610b]
  - @shipfox/api-auth-dto@10.0.0
  - @shipfox/node-fastify@0.4.0
  - @shipfox/api-workflows-dto@10.0.0
  - @shipfox/expression@1.2.0
  - @shipfox/api-agent-dto@10.0.0
  - @shipfox/api-workspaces-dto@10.0.0
  - @shipfox/api-projects-dto@10.0.0
  - @shipfox/api-runners-dto@10.0.0
  - @shipfox/api-auth-context@10.0.0
  - @shipfox/node-module@1.0.4
  - @shipfox/api-definitions-dto@10.0.0
  - @shipfox/annotations-dto@9.0.2
  - @shipfox/api-integration-core-dto@9.0.2
  - @shipfox/api-secrets-dto@9.0.2
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

### Minor Changes

- 6017e56: Reject new workflow work for suspended or deleted workspaces with stable non-retryable results.

### Patch Changes

- Updated dependencies [10cf63c]
- Updated dependencies [4425c6d]
- Updated dependencies [6017e56]
- Updated dependencies [7b6a409]
  - @shipfox/api-auth-dto@9.3.0
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/api-workflows-dto@9.3.0
  - @shipfox/api-workspaces-dto@9.3.0
  - @shipfox/api-auth-context@9.3.0
  - @shipfox/node-fastify@0.3.4
  - @shipfox/node-module@1.0.3
  - @shipfox/node-temporal@0.4.4

## 9.2.0

### Patch Changes

- Updated dependencies [456c884]
  - @shipfox/api-auth-dto@9.2.0
  - @shipfox/api-projects-dto@9.2.0
  - @shipfox/api-auth-context@9.2.0

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
  - @shipfox/annotations-dto@9.0.2
  - @shipfox/api-agent-dto@9.0.2
  - @shipfox/api-auth-context@9.0.2
  - @shipfox/api-auth-dto@9.0.2
  - @shipfox/api-definitions-dto@9.0.2
  - @shipfox/api-integration-core-dto@9.0.2
  - @shipfox/api-projects-dto@9.0.2
  - @shipfox/api-runners-dto@9.0.2
  - @shipfox/api-secrets-dto@9.0.2
  - @shipfox/api-workflows-dto@9.0.2
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
- a041e25: Moves lease-state validation behind the Runners inter-module boundary.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
- Updated dependencies [154e03f]
  - @shipfox/api-secrets-dto@9.0.1
  - @shipfox/runner-labels@0.1.2
  - @shipfox/expression@1.1.4
  - @shipfox/workflow-document@2.1.2
  - @shipfox/annotations-dto@9.0.1
  - @shipfox/api-agent-dto@9.0.1
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/api-auth-dto@9.0.1
  - @shipfox/api-definitions-dto@9.0.1
  - @shipfox/api-integration-core-dto@9.0.1
  - @shipfox/api-projects-dto@9.0.1
  - @shipfox/api-runners-dto@9.0.1
  - @shipfox/api-workflows-dto@9.0.1
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

- 074e7b3: Decouples workflow test fixtures from peer API implementations.
- 46aa52f: Closes remaining API package-boundary exceptions and moves model-provider policy behind the Agent implementation boundary.
- a9f9c57: Decouples Definitions and Workflows tests from peer implementation packages and databases.
- Updated dependencies [46aa52f]
- Updated dependencies [02974d6]
- Updated dependencies [4a6d124]
  - @shipfox/api-agent-dto@9.0.0
  - @shipfox/api-integration-core-dto@9.0.0
  - @shipfox/api-secrets-dto@9.0.0
  - @shipfox/api-auth-context@9.0.0
  - @shipfox/annotations-dto@6.0.0
  - @shipfox/api-auth-dto@7.1.0
  - @shipfox/api-definitions-dto@6.0.0
  - @shipfox/api-projects-dto@8.0.0
  - @shipfox/api-runners-dto@7.0.1
  - @shipfox/api-workflows-dto@9.0.0
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

### Patch Changes

- de559bb: Moves Agent validation policy behind a versioned inter-module catalog and injects it into Definitions normalization.
- b15f3a7: Removes Auth implementation dependencies from consumer test boundaries.
- Updated dependencies [de559bb]
- Updated dependencies [b15f3a7]
- Updated dependencies [7f227c6]
  - @shipfox/api-agent-dto@8.0.0
  - @shipfox/api-runners@8.0.0
  - @shipfox/api-integration-core-dto@8.0.0
  - @shipfox/api-projects-dto@8.0.0
  - @shipfox/api-workflows-dto@8.0.0

## 7.1.0

### Patch Changes

- Updated dependencies [ac42c96]
- Updated dependencies [769d919]
- Updated dependencies [6ce08c0]
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-temporal@0.4.0
  - @shipfox/api-runners@7.1.0
  - @shipfox/api-auth-dto@7.1.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/api-auth-context@7.1.0
  - @shipfox/api-projects@7.1.0

## 7.0.2

### Patch Changes

- @shipfox/api-runners@7.0.2

## 7.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/api-runners@7.0.1
  - @shipfox/api-runners-dto@7.0.1

## 7.0.0

### Patch Changes

- Updated dependencies [bc7cfdc]
  - @shipfox/api-runners@7.0.0
  - @shipfox/api-runners-dto@7.0.0

## 6.0.0

### Major Changes

- a8f0545: Adds the versioned Definitions workflow snapshot contract and registered presentation.
- 9006b75: Adds the Runners inter-module contract and requires the injected Runners client when composing Workflows.

### Minor Changes

- 23563de: Moves Triggers to the injected Workflows inter-module contract with stable run idempotency and listener delivery commands.
- a42b575: Exposes Secrets through its inter-module contract and migrates Agent, integrations, and Workflows consumers.
- 23a4dc2: Moves Logs and Integrations to injected Workflows inter-module clients with minimal log and leased agent-tool queries.

### Patch Changes

- 0bb82a4: Adds the Agent and Integrations inter-module APIs, moving Workflows agent configuration, runtime credential resolution, and integration consumers behind producer-owned clients.
- 9cb2442: Moves workflow capability-warning annotations behind the producer-owned inter-module API.
- b70f920: Adds assigned runner activation and descendant provisioner revocation.
- 112c0fa: Adds the Auth inter-module token-minting contract and removes Auth implementation and configuration coupling from its consumers.
- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- Updated dependencies [e52513c]
- Updated dependencies [a8f0545]
- Updated dependencies [0bb82a4]
- Updated dependencies [9cb2442]
- Updated dependencies [b70f920]
- Updated dependencies [23563de]
- Updated dependencies [6a52909]
- Updated dependencies [e6eba5b]
- Updated dependencies [54ce48b]
- Updated dependencies [add4c77]
- Updated dependencies [9006b75]
- Updated dependencies [3cda0c6]
- Updated dependencies [ba2e3dc]
- Updated dependencies [f4bc2eb]
- Updated dependencies [c0162b0]
- Updated dependencies [7ac43a4]
- Updated dependencies [f262539]
- Updated dependencies [a01e917]
- Updated dependencies [3bb4e26]
- Updated dependencies [a42b575]
- Updated dependencies [112c0fa]
- Updated dependencies [8bdc149]
- Updated dependencies [795e293]
- Updated dependencies [e10c829]
- Updated dependencies [f73da5d]
- Updated dependencies [3810996]
- Updated dependencies [23a4dc2]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [4a91956]
- Updated dependencies [81f9544]
- Updated dependencies [4604a06]
- Updated dependencies [6741be8]
  - @shipfox/api-runners@6.0.0
  - @shipfox/api-runners-dto@6.0.0
  - @shipfox/api-definitions-dto@6.0.0
  - @shipfox/api-agent-dto@6.0.0
  - @shipfox/api-integration-core-dto@6.0.0
  - @shipfox/api-projects@6.0.0
  - @shipfox/annotations-dto@6.0.0
  - @shipfox/api-workflows-dto@6.0.0
  - @shipfox/api-auth-dto@6.0.0
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
  - @shipfox/annotations@5.0.0
  - @shipfox/api-agent@5.0.0
  - @shipfox/api-agent-dto@5.0.0
  - @shipfox/api-auth@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-definitions@5.0.0
  - @shipfox/api-projects@5.0.0
  - @shipfox/api-runners@5.0.0
  - @shipfox/api-runners-dto@5.0.0
  - @shipfox/api-secrets@5.0.0
  - @shipfox/api-secrets-dto@5.0.0
  - @shipfox/api-workflows-dto@5.0.0
  - @shipfox/expression@1.1.3
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-error-monitoring@0.1.3
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-module@0.3.2
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-outbox@0.2.3
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-temporal@0.3.1
  - @shipfox/runner-labels@0.1.1

## 4.0.0

### Patch Changes

- Updated dependencies [5d129d6]
- Updated dependencies [67176d4]
- Updated dependencies [0b0a9c2]
- Updated dependencies [bbba3b7]
- Updated dependencies [1951293]
  - @shipfox/api-integration-core@4.0.0
  - @shipfox/api-auth@4.0.0
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-definitions@4.0.0
  - @shipfox/api-projects@4.0.0
  - @shipfox/annotations@4.0.0
  - @shipfox/api-runners@4.0.0
  - @shipfox/api-agent@4.0.0
  - @shipfox/api-secrets@4.0.0
  - @shipfox/node-module@0.3.1
  - @shipfox/node-outbox@0.2.2

## 3.0.0

### Patch Changes

- 7a71e7d: Aligns published dependency ranges with the workspace catalog policy.
- 08fc93b: Adds prebuilt production Temporal workflow bundles to API packages and removes runtime workflow compilation.
- Updated dependencies [3976f8c]
- Updated dependencies [c5ee18f]
- Updated dependencies [7a71e7d]
- Updated dependencies [08fc93b]
  - @shipfox/node-module@0.3.0
  - @shipfox/api-auth@3.0.0
  - @shipfox/node-temporal@0.3.0
  - @shipfox/api-agent@3.0.0
  - @shipfox/api-definitions@3.0.0
  - @shipfox/api-integration-core@3.0.0
  - @shipfox/api-projects@3.0.0
  - @shipfox/api-runners@3.0.0
  - @shipfox/expression@1.1.2
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/annotations@3.0.0
  - @shipfox/api-secrets@3.0.0
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
- Updated dependencies [c31a7e0]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-module@0.2.0
  - @shipfox/api-integration-core@2.0.0
  - @shipfox/node-temporal@0.2.0
  - @shipfox/api-auth@2.0.0
  - @shipfox/annotations@2.0.0
  - @shipfox/api-agent@2.0.0
  - @shipfox/api-agent-dto@2.0.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-definitions@2.0.0
  - @shipfox/api-projects@2.0.0
  - @shipfox/api-runners@2.0.0
  - @shipfox/api-runners-dto@2.0.0
  - @shipfox/api-secrets@2.0.0
  - @shipfox/api-secrets-dto@2.0.0
  - @shipfox/api-workflows-dto@2.0.0
  - @shipfox/runner-labels@0.1.0
  - @shipfox/expression@1.1.1
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-error-monitoring@0.1.2
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-outbox@0.2.1
  - @shipfox/node-postgres@0.4.1

## 0.1.2

### Patch Changes

- Updated dependencies [705dd43]
  - @shipfox/node-outbox@0.2.0
  - @shipfox/api-auth@0.1.2
  - @shipfox/api-definitions@0.1.2
  - @shipfox/api-integration-core@0.1.2
  - @shipfox/api-projects@0.1.2
  - @shipfox/api-runners@0.1.2
  - @shipfox/api-secrets@0.1.2
  - @shipfox/node-module@0.1.2
  - @shipfox/annotations@0.0.3
  - @shipfox/api-agent@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/api-agent@0.1.1
  - @shipfox/annotations@0.0.2
  - @shipfox/api-auth@0.1.1
  - @shipfox/api-definitions@0.1.1
  - @shipfox/api-integration-core@0.1.1
  - @shipfox/api-projects@0.1.1
  - @shipfox/api-runners@0.1.1
  - @shipfox/api-secrets@0.1.1
  - @shipfox/node-module@0.1.1
  - @shipfox/node-outbox@0.1.1

## 0.1.0

### Minor Changes

- 5c18360: Durable gate restart: a failing gate's `on_failure.restart_from` now records the failed attempt, rewinds the job's step projection from the named earlier step back to pending (opening fresh attempts), and leaves the job running so it re-executes from there — all in one transaction with the report. A per-step attempt cap (default 3) bounds restart loops, exhausting to a `restart_exhausted` failure. Adds the `workflows.step.restart_enqueued` event.
- a56748d: Adds ingestion-time agent session parsing with a stored canonical SessionView read endpoint and workflow harness lookup.
- 7a9943d: Adds the backend contract for per-step execution: job claims mint a lease token for the step API, step reports carry attempts and exit codes, and workflow completion can be signalled through the workflows outbox. The runner-side step loop is intentionally owned by the follow-up runner protocol work.
- 736249b: Expose step attempts in the read API: the run-detail endpoint now returns `current_attempt` on each step plus its per-attempt history (`attempts[]`, with status, exit code, gate result and restart reason), so a restarted step's attempts are visible.
- 2bc5595: Adds workflow-run cancellation across the API, orchestration queue cleanup, event contract, and run-page cancel action.
- f9f059e: Cut the runner protocol over to per-step pull/report and remove the job-atomic path.

  The job workflow now terminates on two signals: `job-finished` (raised by
  `recordStepResult` on step exhaustion) and `job-lease-expired` (raised by the new
  `runners.job.lease_expired` subscriber). A precedence ladder keeps a genuinely
  finished job from being failed by a late lease expiry, and the lease-expiry branch
  re-derives the outcome from the authoritative step projection in a single
  transaction (server state is the final gate). On finish the workflow releases the
  lease via `releaseJob` (deleting both the running and any orphaned pending row);
  release is best-effort so a Scheduling outage never blocks the run DAG.

  Removed the atomic path end to end: the runner `POST /runners/jobs/:jobId/complete`
  route, the `RUNNER_JOB_COMPLETED` event, `finalizeRunningJob`/`completeJob`, the
  `applyStepResults*` apply path and its workflow subscriber, and the dead
  `jobPayload*`/`complete-job` DTO schemas. The runner now parses the step-less claim
  response, and `claimPendingJob` drops an orphan pending row instead of poison-looping.

  Internal breaking change (deleted exported DTOs/events and a runner route, plus a
  Temporal signal rename) consumed only within this monorepo; backend and agent ship
  together.

- f98c2be: [api/workflows] Add the lease-authed `POST /runs/jobs/current/checkout-token` endpoint. The runner exchanges its job lease for short-lived, read-only repository checkout credentials. The job's checkout intent is resolved server-side from the authoritative `jobId` claim (`job -> run -> project` source metadata) and minted on demand via the integration service's `createCheckoutSpec()`; no credential material is ever stored on the job/run or queued. `checkoutTokenResponseSchema.auth` stays optional so credential-free providers can return a public clone URL with no token, and `integrationRouteErrorHandler` is exported from `@shipfox/api-integration-core` so the route reuses the shared provider-error mapping.
- e9396c9: Give every runner-dispatched job a synthetic "Set up job" step at position 0 (à la GitHub Actions), so failures that happen around the user steps — workspace preparation today, the repository checkout next — are reported through the existing per-step protocol instead of hanging the job until the lease/timeout fires. The runner prepares the per-job workspace inside this step and reports the outcome; a failed setup flows through the existing fail-job cascade, finalizing the job `failed` in seconds with no user step run.

  Extends `stepErrorDtoSchema` with an optional machine-readable `reason` (`workspace_prep_failed`, `git_unavailable`, `checkout_*`, `setup_aborted`) and a `category` (`setup` | `user`). The runner reports `reason`; the server derives `category` from the step type on read (the runner is an untrusted boundary). The restart resolver now skips the synthetic step so a user step named "Set up job" can never rewind setup mid-job.

- 139e3be: Execute step gates at runtime: evaluate `gate.success_if` (CEL) against the step's exit code to decide pass/fail — overriding the raw command status — and record the gate result on the attempt. A failing gate fails the job; a missing exit code or an evaluation error fails closed as a plain command failure; a failing gate with `on_failure.restart_from` fails closed with a structured `restart_unsupported` error until durable restart lands.
- c652a68: Add a single reliable job-terminal event: `workflows.job.terminated` is now written in the same transaction as every terminal job-status flip (normal completion, DAG cancellation, lease-expiry resolution, and timeout), and the run-level `workflows.workflow_run.terminated` is emitted the same way. All workflows event names are aligned on one `WORKFLOWS_<entity>_<verb>` scheme, so the run and job terminal events read as the same event at two scopes.

  Internal breaking change (`WORKFLOWS_JOB_COMPLETED` → `WORKFLOWS_JOB_STEPS_SETTLED`, `WORKFLOW_RUN_*` → `WORKFLOWS_WORKFLOW_RUN_*`, with matching DTO type renames) consumed only within this monorepo.

- 121b42e: Track per-step execution attempts: add a `step_attempts` history table and a `steps.current_attempt` column, open a running attempt at dispatch and finalize it at report, and make step-result reporting attempt-aware (idempotent duplicate reports, rejected future attempts, no-op stale attempts).
- c0a883c: Adds the runner-facing per-step endpoints (`POST /runs/jobs/current/steps/next` and `/steps/:stepId/report`) authed by a locally-verified job lease token, with the matching request/response schemas.
- d69b164: Adds workflow run attempt lineage APIs and a run summary switcher for navigating rerun attempts.
- b74f635: Adds workflow run interpolation context resolution while preserving authored step configuration for reruns and diagnostics.
- e699508: Adds first-class skipped workflow jobs with persisted status reasons across API DTOs, orchestration, events, and client run views.

### Patch Changes

- eb40964: Add an inline `agent` workflow step that the runner runs with the pi harness. A step is an agent step when it carries `model` + `prompt` and no `run`; it takes a free-text `model`, a single `prompt`, and an optional `thinking` level (default `high`). The step runs to process-success (the agent ran to completion) and reports through the existing step protocol with no runner/backend protocol change, so change quality is judged by a downstream `run` + `gate` step. v1 does not persist the agent's work (no diff, commit, or PR).
- 2c156d2: Extracts pure workflow runtime scheduling decisions behind the existing workflows orchestration host.
- f788565: Unifies workflow step config field resolution and agent default completion across creation and dispatch fill sites.
- b1f57d1: Moves agent model provider credentials onto the shared secrets store while keeping provider config metadata and runtime resolution behavior intact.
- 97162dd: Resolves model provider, model, and thinking defaults at workflow run creation using workspace and instance configuration.
- b694b09: Add the per-step progression domain service (`nextStepForJob`, `recordStepResult`) and its guarded DB primitives over the existing `steps` table. Dormant until the per-step runner protocol is wired into the HTTP and orchestration layers; no runtime behavior changes yet.
- c47be09: Reshape Scheduling around runner job leases. Jobs are now enqueued with `workflowRunId`, `workflowRunAttemptId`, `jobId`, and `jobExecutionId`; the claim route mints a job lease token and returns the same workflow/job identity tuple. The stuck-job detector emits `runners.job.lease_expired` with that tuple when a lease expires.
- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- e250c4c: Propagates `projectId` end-to-end into the job lease token. Workflows sources the `{workspaceId, projectId, workflowRunId, workflowRunAttemptId, jobId, jobExecutionId}` identity tuple and threads it through the runner pending/running job tables and lease claims. This is lease-shape groundwork for per-project log-ingest authorization; the stream-stamping consumer lands separately.
- b525dcd: Let an agent workflow step pick its pi provider with an optional free-text `provider` field (default `anthropic`), threaded to the runner's pi model lookup, and split agent-step failures into a user-fixable `agent_config_invalid` reason (unknown provider, missing runner credentials, wrong provider/model pair) versus `agent_invocation_failed` for genuine provider/API errors.
- a982f20: Stop a permanently-broken trigger subscription from starving its siblings or wedging the outbox. Integration dispatch now attempts every matched subscription and classifies each `runWorkflow` failure: a permanent error (deleted definition or project mismatch) is recorded and skipped, while a transient one re-throws so the outbox replays the event and converges. The event reaches a terminal outcome once no transient error remains (`routed` when any run was created, otherwise the new `errored` outcome), with a guarded write that never records `errored` over an event that already produced a run. The manual-fire path records the same terminal outcome, and `@shipfox/api-workflows` exports an `isPermanentRunWorkflowError` classifier. The trigger-events read API (`triggerEventOutcomeSchema`) accepts the new `errored` outcome for serialization and filtering.
- 998eba3: Adds phase-aware workflow context metadata, availability predicates, and creation-phase workflow context assembly for runtime materialization.
- 5327934: Materialize listening job steps per execution instead of during workflow run creation.
- 314e84e: Adds server-side step condition skipping so rejected or errored step predicates finish as skipped without dispatching runner attempts.
- 247cbd6: Adds label-aware runner job claiming with shared runner-label validation and required-label orchestration.
- 795f440: Adds the listener orchestration loop for long-lived listening jobs: durable event draining, one execution per buffered event, resolution on until, listening deadline, or max executions, and a run-timeout backstop that resolves active listeners.
- 3dcd751: Adds listener filter snapshots to job activation events and persists them on listener subscriptions.
- 362b3eb: Scope runner log append authorization to the dispatched step attempt carried by the job lease token.
- 6077301: Adds shared timestamp/id keyset pagination helpers and migrates workflow run and trigger event lists onto them.
- 9c1c947: Colocates workflow phase context assembly and threads phase-tagged evaluation contexts through runtime fill sites.
- d635979: Routes workflow materialization and predicate evaluation through persisted planner segments, replacing resolver exports with planned freeze APIs.
- 3bea87f: Adds a typed `subscriberFactory` that binds each outbox event name to its payload type at construction, so subscriber handlers receive a typed `(payload, event)` and the per-handler `event.payload as X` casts are gone; a private brand makes the factory the only way to build a module subscriber.
- ef1e917: Adds listening-job authoring fields and trusted execution context validation for listening jobs.
  Separates workflow identifiers so internal rows use UUID `id`, authored workflow/job/step
  references use `key`, and UI labels use `name`.
- c6eb2ee: Adds debounced listener-event batching with DB-backed coalescing, max-size chunking, and batch-size metrics.
- f9153e8: Persists parsed workflow models on run attempts so later workflow phases can materialize from the frozen template.
- a8905ed: Splits workflow runtime internals into scheduling and step-config modules without changing behavior.
- 282e66a: Exposes frozen agent integration tool selections as non-secret MCP server descriptors in materialized step config.
- 0dd23a7: Warns on agent tool capability mismatches during dispatch without blocking label-matched runners.
- e1d4972: Evaluate the step gate `success_if` over the `step` self-root (`step.exit_code`, `step.status`) and job `success` over the full typed executions context, both validated against the shared context registry; authored gate expressions move from `exit_code` to `step.exit_code` and job-success now fails closed on a runtime evaluation error.
- f9bf446: Extract the step-report decision into a pure `decideStepTransition` plus a durable `applyStepTransition`, creating the seam where gate evaluation and durable restart will plug in. No behavior change.
- 8ecc121: Track queue/run/finish timing for workflow runs and jobs. Adds nullable `started_at`/`finished_at` to workflow runs and `queued_at`/`started_at`/`finished_at` to jobs, exposed on the run and job DTOs. The runners module emits two new authoritative-timestamp events (`runners.job.queued`, `runners.job.started`) in the same transaction as the enqueue/claim; workflows projects them onto the job row with a first-write-wins `coalesce`, so the at-least-once outbox can redeliver out of order safely. Run `started_at`/`finished_at` and job `finished_at` are stamped in-module at the status transitions. All columns are nullable and eventually consistent, so consumers must treat a missing endpoint as "not yet known" and clamp any duration math.
- d7b9596: Refold the workflows migration baseline and tune its indexes. Drops the redundant `step_attempts(job_execution_id)` index, which was fully covered by the `(job_execution_id, execution_order)` unique index. Adds partial `WHERE status = 'running'` indexes on `workflow_runs` and `job_executions` so the running-depth service gauge counts only active rows instead of sequentially scanning the full history on every scrape. No behavior or API change.
- Updated dependencies [eb40964]
- Updated dependencies [0a6318f]
- Updated dependencies [7bc7498]
- Updated dependencies [5c18360]
- Updated dependencies [067a260]
- Updated dependencies [26fea4b]
- Updated dependencies [0cf66c4]
- Updated dependencies [0948b67]
- Updated dependencies [34ba284]
- Updated dependencies [8100b48]
- Updated dependencies [8f51daf]
- Updated dependencies [3b45d86]
- Updated dependencies [5707d6d]
- Updated dependencies [e689abf]
- Updated dependencies [59ba68b]
- Updated dependencies [7a9943d]
- Updated dependencies [ce3e5ca]
- Updated dependencies [b9c3f32]
- Updated dependencies [2325d76]
- Updated dependencies [89026d5]
- Updated dependencies [d02c5fd]
- Updated dependencies [c17dd6e]
- Updated dependencies [a81b68c]
- Updated dependencies [115655e]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [cdf8989]
- Updated dependencies [5cdfc69]
- Updated dependencies [e47f8da]
- Updated dependencies [736249b]
- Updated dependencies [a68ed61]
- Updated dependencies [2bc5595]
- Updated dependencies [b1f57d1]
- Updated dependencies [1127ba2]
- Updated dependencies [36f871d]
- Updated dependencies [e7b01dd]
- Updated dependencies [de54da2]
- Updated dependencies [d546b88]
- Updated dependencies [58c05ed]
- Updated dependencies [ce062a9]
- Updated dependencies [7b175f5]
- Updated dependencies [7ca4c65]
- Updated dependencies [5bcdbf4]
- Updated dependencies [97162dd]
- Updated dependencies [857879a]
- Updated dependencies [c47be09]
- Updated dependencies [f9f059e]
- Updated dependencies [940696a]
- Updated dependencies [f3614ae]
- Updated dependencies [f98c2be]
- Updated dependencies [e9396c9]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [d245be8]
- Updated dependencies [f92122b]
- Updated dependencies [e250c4c]
- Updated dependencies [b525dcd]
- Updated dependencies [f8f339a]
- Updated dependencies [b0a0e1a]
- Updated dependencies [58f51bd]
- Updated dependencies [570ac69]
- Updated dependencies [857fd73]
- Updated dependencies [aca162b]
- Updated dependencies [1c1fb3e]
- Updated dependencies [7fa8f0b]
- Updated dependencies [998eba3]
- Updated dependencies [3afb7e3]
- Updated dependencies [2617db9]
- Updated dependencies [444ac89]
- Updated dependencies [1daf39a]
- Updated dependencies [247cbd6]
- Updated dependencies [1d98b19]
- Updated dependencies [5823bac]
- Updated dependencies [5d53ed4]
- Updated dependencies [c652a68]
- Updated dependencies [fb64f13]
- Updated dependencies [75520ff]
- Updated dependencies [f47cff8]
- Updated dependencies [62720ea]
- Updated dependencies [b855d6f]
- Updated dependencies [795f440]
- Updated dependencies [3dcd751]
- Updated dependencies [f66f606]
- Updated dependencies [c0a883c]
- Updated dependencies [362b3eb]
- Updated dependencies [e51d464]
- Updated dependencies [b8e49ff]
- Updated dependencies [5b8ed32]
- Updated dependencies [417f128]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [f0afdf8]
- Updated dependencies [9d3b43a]
- Updated dependencies [d635979]
- Updated dependencies [3bea87f]
- Updated dependencies [82d22e4]
- Updated dependencies [d69b164]
- Updated dependencies [69d02e5]
- Updated dependencies [2fb3e87]
- Updated dependencies [e0fee57]
- Updated dependencies [b74f635]
- Updated dependencies [fa67aa3]
- Updated dependencies [9a5aac4]
- Updated dependencies [ef1e917]
- Updated dependencies [51eb38a]
- Updated dependencies [61de795]
- Updated dependencies [88b9793]
- Updated dependencies [e2fbef8]
- Updated dependencies [8ecba0f]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [2ad300c]
- Updated dependencies [a314b05]
- Updated dependencies [43fd0c1]
- Updated dependencies [950ebef]
- Updated dependencies [03d9eae]
- Updated dependencies [a5c7562]
- Updated dependencies [6181819]
- Updated dependencies [3ddde91]
- Updated dependencies [1ea2f6a]
- Updated dependencies [e699508]
- Updated dependencies [ad6056b]
- Updated dependencies [8b9c3e0]
- Updated dependencies [282e66a]
- Updated dependencies [0dd23a7]
- Updated dependencies [9c149d1]
- Updated dependencies [e1d4972]
- Updated dependencies [fb64f13]
- Updated dependencies [a856155]
- Updated dependencies [8ecc121]
  - @shipfox/api-definitions@0.1.0
  - @shipfox/api-workflows-dto@0.1.0
  - @shipfox/api-agent@0.1.0
  - @shipfox/expression@1.1.0
  - @shipfox/api-agent-dto@0.1.0
  - @shipfox/api-integration-core@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-runners@0.1.0
  - @shipfox/api-runners-dto@0.1.0
  - @shipfox/api-secrets@0.1.0
  - @shipfox/api-secrets-dto@0.1.0
  - @shipfox/annotations@0.0.1
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-auth@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-projects@0.1.0
  - @shipfox/node-error-monitoring@0.1.1
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/runner-labels@0.0.1
