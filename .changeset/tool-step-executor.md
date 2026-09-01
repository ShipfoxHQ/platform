---
'@shipfox/api-workflows': major
'@shipfox/api-server': patch
---

Execute queued workflow tool steps on the server instead of the client.

The API Workflows module now requires the Logs inter-module client and starts a
server-side tool-step executor by default. Set
`WORKFLOWS_TOOL_STEP_EXECUTOR_ENABLED=false` before restarting an API process
to disable new tool-step calls. Older API builds do not run this executor, so
drain or settle pending tool invocations before rolling back this release.
