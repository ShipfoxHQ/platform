---
"@shipfox/workflow-document": minor
"@shipfox/api-definitions": minor
"@shipfox/api-definitions-dto": minor
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
---

Accept a `${{ }}` interpolation in an agent step's `thinking` field. The schema
still offers the per-harness enum for editor completion, and the dispatcher
checks the resolved value against the harness levels. An unsupported
resolved level fails the step.
