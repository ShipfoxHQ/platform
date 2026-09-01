# @shipfox/api-definitions-dto

## 20.1.0

### Patch Changes

- 6207ce3: Adds bounded workflow run overview and job-page APIs with capped execution counts and source-snapshot enforcement.

## 20.0.0

### Patch Changes

- Updated dependencies [46ae6a8]
  - @shipfox/workflow-document@3.4.0
  - @shipfox/expression@2.4.3

## 19.0.0

### Minor Changes

- 5af8d52: Adds project catalog and workflow-definition reads, plus trigger-event summaries, details, and facets.

### Patch Changes

- Updated dependencies [b416c4c]
  - @shipfox/expression@2.4.2
  - @shipfox/workflow-document@3.3.2
  - @shipfox/inter-module@0.2.3
  - @shipfox/regex@0.3.0

## 17.0.0

### Patch Changes

- Updated dependencies [9fdba44]
- Updated dependencies [be5fb95]
  - @shipfox/workflow-document@3.3.1
  - @shipfox/expression@2.4.1

## 16.1.0

### Minor Changes

- 870523f: Adds the tool step model: a `kind: 'tool'` step in the `definitions-dto` step union (snapshot version 3) carrying `tool`, `connection`, `with`, `outputMappings`, and `templates`, with sync-time validation (`missing-connection-for-tool`, `integration-connection-not-found` / `-not-capable`, `unknown-integration-tool`, `tool-input-invalid`, `tool-input-unknown-key`). `@shipfox/api-workflows` and `@shipfox/api-workflows-dto` add the tool step to the run-graph step type union and its display name. The workflow document parser still rejects tool-step fields, so nothing is user-authorable yet.

## 16.0.0

### Minor Changes

- 117edfd: Adds named agent sessions with validated keys and resume or fork modes.

### Patch Changes

- Updated dependencies [117edfd]
  - @shipfox/workflow-document@3.3.0
  - @shipfox/expression@2.4.0

## 15.0.0

### Minor Changes

- a7804a8: Adds `GET /definitions/at-ref` listing workflow definitions at a git ref with their validation state and the pinned commit, backing the run-from-branch picker.

### Patch Changes

- Updated dependencies [b7d522a]
- Updated dependencies [a7804a8]
- Updated dependencies [050b796]
- Updated dependencies [0b6addb]
  - @shipfox/expression@2.3.0
  - @shipfox/regex@0.3.0
  - @shipfox/workflow-document@3.2.0

## 14.0.0

### Major Changes

- f7b3db8: Replaces published definition warning exports and the sync `warnings` field with severity-aware diagnostics, including workflow file paths for the workflows UI.

  Consumers must migrate from `warnings` to `diagnostics`; this release does not provide a legacy-field fallback.

- aeaa0de: Adds stable workflow lineage identifiers to definition records and the definitions inter-module contract. Existing definitions are reconciled when read or synchronized, so the schema migration does not backfill historical rows.

### Minor Changes

- c0fc35b: Adds `resolveDefinitionAtRef` and `listDefinitionsAtRef` inter-module methods that resolve and validate workflow definitions at a git ref without persisting them.
- 4f30864: Trigger `event` is now optional end to end. An omitted event subscribes to every event from its source. Explicit events continue to work unchanged. Built-in manual and scheduled triggers use `fire` and `tick`, respectively.

### Patch Changes

- Updated dependencies [4f30864]
  - @shipfox/workflow-document@3.1.0
  - @shipfox/expression@2.2.1

## 12.3.0

### Patch Changes

- Updated dependencies [3e7fe76]
  - @shipfox/expression@2.2.0

## 12.2.0

### Patch Changes

- Updated dependencies [ce0984d]
  - @shipfox/expression@2.1.0
  - @shipfox/workflow-document@3.0.1

## 12.0.0

### Major Changes

- adf07e7: Cut over workflow and job display names to literal-only `name` fields, with runtime interpolation supported through `run_name` and `execution_name`.

### Minor Changes

- ee2ce67: Accept a `${{ }}` interpolation in an agent step's `thinking` field. The schema
  still offers the per-harness enum for editor completion, and the dispatcher
  checks the resolved value against the harness levels. An unsupported
  resolved level fails the step.
- 5d2c9cf: Carry checkout steps from workflow normalization through step materialization and surface their setup error category.
- 89f2c18: Expose non-fatal definition validation warnings from the `/validate` response without
  preventing workflow synchronization. Persistence and surfacing for repo-synced definitions
  remain a follow-up.
- 9e1d599: Carry first-checkout intent through workflow normalization and step materialization for the upcoming runner checkout execution, including implicit-checkout suppression, checkout opt-out, and position-based primary checkout placement.
- 3f781ee: Add workflow run and job execution naming fields to the authoring, expression, and normalized definition contracts.
- 9fdd5e4: Persist definition validation warnings from repository syncs and surface them on the workflow page without changing sync success or run creation behavior.
- 35a42bd: Resolve run and agent step working directories against the runner job workspace.
- c2a8e54: Normalize checkout target fields for step-dispatch resolution, reject unsupported job-level checkout fields, and keep the workflow model and runtime checkout contracts aligned.

### Patch Changes

- Updated dependencies [ee2ce67]
- Updated dependencies [7c4116e]
- Updated dependencies [e95fdf4]
- Updated dependencies [3d91d1d]
- Updated dependencies [045895c]
- Updated dependencies [f78740d]
- Updated dependencies [dea1ffd]
- Updated dependencies [adf07e7]
- Updated dependencies [3f781ee]
- Updated dependencies [285fff2]
- Updated dependencies [4d246d4]
- Updated dependencies [4444079]
- Updated dependencies [d77baaa]
- Updated dependencies [41d558c]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [cb0abfa]
- Updated dependencies [ee2ce67]
- Updated dependencies [7f90b0c]
  - @shipfox/workflow-document@3.0.0
  - @shipfox/expression@2.0.0
  - @shipfox/inter-module@0.2.3

## 11.0.0

### Patch Changes

- Updated dependencies [71d9ba4]
  - @shipfox/expression@1.2.1

## 10.0.0

### Patch Changes

- Updated dependencies [a713231]
  - @shipfox/expression@1.2.0
  - @shipfox/inter-module@0.2.2
  - @shipfox/workflow-document@2.1.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/expression@1.1.5
  - @shipfox/inter-module@0.2.2
  - @shipfox/workflow-document@2.1.3

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
  - @shipfox/expression@1.1.4
  - @shipfox/workflow-document@2.1.2
  - @shipfox/inter-module@0.2.1

## 6.0.0

### Minor Changes

- a8f0545: Adds the versioned Definitions workflow snapshot contract and registered presentation.

### Patch Changes

- Updated dependencies [81f9544]
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 0.0.1

### Patch Changes

- 59ba68b: Integrates workflow definitions with accepted workflow documents and normalized workflow models.
- 7fa8f0b: Fix VCS sync failing when a manual definition shares a config_path. The
  `definitions_wd_project_id_config_path_unique` index was source-agnostic, so a
  manual (or validated) definition and a ref/sha-keyed VCS definition at the same
  `config_path` collided on an index that was not the VCS upsert's `ON CONFLICT`
  arbiter, raising an unhandled unique violation and breaking sync. The index (and
  the manual upsert predicate) is now scoped to manual rows so the two coexist.

  A CHECK constraint and request validation now bind `source` to its git
  coordinates (vcs rows carry a ref or sha; manual rows carry neither), so the
  index predicate's correctness is enforced rather than incidental.

- 9a5aac4: Adds cron trigger schedule and timezone fields with source-specific document validation.
- 61de795: Adds canonical runner label validation and default runner label fallback for workflow definition parsing.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- b8919da: Removes the unused workflow-spec, job, and step schemas now that `@shipfox/workflow-document` owns workflow document parsing, keeping only the still-used `TriggerDto` type.
