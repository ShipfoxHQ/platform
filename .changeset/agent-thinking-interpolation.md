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
still offers the per-harness enum for editor completion, and the resolved value
is checked against the harness levels when the step dispatches. An unsupported
resolved level fails the step.
