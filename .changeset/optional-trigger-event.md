---
"@shipfox/workflow-document": minor
"@shipfox/api-definitions-dto": minor
"@shipfox/api-definitions": minor
"@shipfox/api-triggers": patch
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": minor
"@shipfox/client-workflows": minor
---

Trigger `event` is now optional end to end. An omitted event subscribes to every event from its source. Explicit events continue to work unchanged. Built-in manual and scheduled triggers use `fire` and `tick`, respectively.
