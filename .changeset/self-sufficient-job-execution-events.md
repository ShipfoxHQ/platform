---
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
---

Adds runner identity to the `runners.job.claimed` projection on `job_executions`, and adds `workspaceId`, `projectId`, `definitionId`, `jobKey`, `queuedAt`, `startedAt`, and runner identity to `workflows.job_execution.terminated` and `jobKey`, `definitionId`, and `runNumber` to `workflows.job_execution.queued`, so a consumer can build a complete usage record from a single event.
