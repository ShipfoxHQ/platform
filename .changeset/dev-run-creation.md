---
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": minor
---

Adds the `startDevRun` inter-module method that creates a workflow run from an inline model and snapshot with `origin: 'dev'` and dev provenance, numbered by the workflow lineage id. Manual `subscriptionId` and cron `scheduleId` trigger payload fields become optional so a dev trigger can fire without a subscription row.
