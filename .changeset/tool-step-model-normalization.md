---
"@shipfox/api-definitions": minor
"@shipfox/api-definitions-dto": minor
"@shipfox/api-workflows": patch
"@shipfox/api-workflows-dto": patch
---

Adds the tool step model and normalization: `WorkflowModelToolStep` in the `definitions-dto` step union (snapshot version 3), `normalizeToolStep` (family.method split, `with` interpolation trees, `outputs` mappings typed from the catalog `outputSchema`, `steps.<key>` type overlay), sync-time validation against `IntegrationValidationContext` (`missing-connection-for-tool`, `integration-connection-not-found` / `-not-capable`, `unknown-integration-tool` with method listing, `tool-input-invalid`, `tool-input-unknown-key`), and the `hasIntegrationToolReferences` predicate. Tool-step gates validate against the no-`exit_code` report environment. `@shipfox/api-workflows` gains the tool step in the run-graph step type union, its display name, and materialization-context gating for tool-step runs. The workflow document parser still rejects tool-step fields, so nothing is user-authorable yet.
