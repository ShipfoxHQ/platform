---
"@shipfox/api-workflows-dto": major
"@shipfox/api-workflows": major
"@shipfox/client-workflows": major
---

The API now exposes bounded workflow-run overviews, cursor-paginated job executions and step attempts, and dedicated job and step-attempt detail resources. Run-list rows omit heavy trigger payloads, inputs, and source snapshots; the client derives run-list and job-detail status from the API's bounded status fields instead of retaining the client-only `Queued` state.
