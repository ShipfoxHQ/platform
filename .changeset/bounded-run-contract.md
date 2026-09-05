---
"@shipfox/api-workflows-dto": major
"@shipfox/api-workflows": major
"@shipfox/client-workflows": major
---

Removes the legacy `GET /workflows/runs/:id` detail route.
It removes `workflowRunDetailResponseSchema`, `jobDtoSchema`, `jobExecutionDtoSchema`, and their public exports, including `workflowRunJobDetailDtoSchema`, `workflowRunJobExecutionDetailDtoSchema`, `workflowRunStepDetailDtoSchema`, `WorkflowRunJobDetailDto`, `WorkflowRunJobExecutionDetailDto`, and `WorkflowRunStepDetailDto`.
It also removes `WORKFLOW_RUN_DETAIL_REQUEST_KIND_HEADER`, `WORKFLOW_RUN_DETAIL_REQUEST_KINDS`, `WorkflowRunDetailRequestKind`, `getWorkflowRunDetail`, `useWorkflowRunQuery`, `workflowRunQueryOptions`, and `WorkflowRunDetail` exports.
Run-attempt lists now return `{items, next_cursor}` with a default limit of 25; run lists omit trigger payloads, inputs, and source snapshots.
Run-list and job-detail display statuses now use API-provided bounded status fields.
Consumers must migrate to bounded overviews, paginated job and attempt resources, and dedicated job or step-attempt detail reads.
Direct HTTP consumers of the removed detail route receive 404 responses without a compatibility signal.
