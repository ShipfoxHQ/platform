---
"@shipfox/api-definitions": minor
"@shipfox/expression": patch
---

Existing workflows that use external event, input, listening-event, or output data to dynamically select runner labels, agent models, or agent providers now fail validation. Bind dynamic selectors through workflow-authored `vars` or `secrets` instead.
