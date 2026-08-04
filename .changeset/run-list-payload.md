---
"@shipfox/api-workflows-dto": major
"@shipfox/api-workflows": minor
---

Add the trigger reference and the current attempt's jobs to each workflow run in the run list response.

`trigger_reference` carries the repository, ref, commit, and actor a source-control trigger resolved, or null for triggers that resolve none. Jobs arrive as `jobs`, a preview bounded by the new `WORKFLOW_RUN_JOB_PREVIEW_LIMIT`, alongside `job_status_counts` covering every job of the attempt including those past the preview.
