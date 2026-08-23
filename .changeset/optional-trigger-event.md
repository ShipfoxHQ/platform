---
"@shipfox/workflow-document": minor
"@shipfox/api-definitions-dto": minor
"@shipfox/api-definitions": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": minor
---

Makes the trigger `event` field optional end to end. Omitted `event` subscribes the trigger to every event the source delivers: `manual` receives `fire`, `cron` receives `tick`, a custom webhook receives `received`, and integration triggers become source subscriptions that match any event from the connection. The normalizer materializes `fire` and `tick` for the built-in sources; explicit `event` keeps working unchanged.
