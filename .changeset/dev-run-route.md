---
"@shipfox/api-triggers": major
"@shipfox/api-triggers-dto": minor
---

Adds `POST /dev-runs` for manually and cron-triggered dev runs. Manual runs build inputs from the request body (overriding the trigger's `with`); cron runs take inputs from the trigger's `with` and reject body inputs. Pins the optional commit, answering 409 `ref-moved` on mismatch and 422 `replay-event-required` for integration-source triggers. Ships the request body schema and `201 {workflow_run_id, commit}` response DTOs in `@shipfox/api-triggers-dto`.
