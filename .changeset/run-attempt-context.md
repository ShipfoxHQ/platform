---
"@shipfox/expression": minor
"@shipfox/api-workflows": patch
---

Exposes the current workflow run attempt as `run.attempt` in expressions and reruns. Deploy compatible workers before adopting this field in persisted expressions because older builds omit it and cause those expressions to fail closed.
