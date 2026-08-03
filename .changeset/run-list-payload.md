---
"@shipfox/api-workflows-dto": major
"@shipfox/api-workflows": minor
---

Expose the trigger reference and the current attempt's jobs on the workflow run list, so a run row can report its branch, commit, actor, and where it failed without opening the run.

Jobs arrive as a bounded preview (`WORKFLOW_RUN_JOB_PREVIEW_LIMIT`) plus `job_status_counts` covering every job, so one large workflow cannot decide how much the endpoint returns, and a row can still report a failure sitting past the preview. Both reads are issued once per page and pinned to the attempt the run read returned, so a re-run landing mid-request cannot pair one attempt's metadata with another's jobs.
