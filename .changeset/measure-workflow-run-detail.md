---
"@shipfox/api-workflows": patch
"@shipfox/api-workflows-dto": minor
"@shipfox/client-workflows": patch
---

Add the `WORKFLOW_RUN_DETAIL_REQUEST_KIND_HEADER` request-kind header and `WorkflowRunDetailRequestKind` type for workflow-run detail reads; client-workflows detail requests now send the request kind, which the API records as initial versus polling.
