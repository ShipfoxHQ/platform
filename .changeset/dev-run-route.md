---
"@shipfox/api-triggers": minor
"@shipfox/api-triggers-dto": minor
---

Adds `POST /dev-runs` for manual and cron triggers: resolves the workflow definition at a git ref through `definitions.resolveDefinitionAtRef`, pins the optional commit (409 `ref-moved` on mismatch), fires the trigger without creating any subscription row, and journals the attempt as a `dev` received event with a single `dev` decision. Body schema and `201 {workflow_run_id, commit}` response DTOs ship in `@shipfox/api-triggers-dto`. Integration-source triggers answer 422 `replay-event-required` until targeted replay lands.

Deploy note: the route calls `workflows.startDevRun` over the inter-module transport, so `@shipfox/api-workflows` must be on a build that presents that method before `@shipfox/api-triggers` with this route is deployed.
