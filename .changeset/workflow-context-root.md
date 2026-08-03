---
"@shipfox/expression": major
"@shipfox/api-workflows": minor
---

Split workflow definition facts out of the `run` context into a `workflow` root.
`run.workflow_name` becomes `workflow.name` and `run.definition_id` becomes
`workflow.id`, so `workflow` and `run` mirror the `job` and `execution` pair.
Add `contextRootsForField` to return the readable roots for a predicate or an
interpolation field without requiring the caller to choose a mechanism. Add
`workflowContextDocs` as the reader-facing description of every root and property.
