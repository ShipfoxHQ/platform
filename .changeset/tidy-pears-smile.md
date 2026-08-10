---
'@shipfox/api-workflows': minor
'@shipfox/api-workflows-dto': minor
'@shipfox/client-workflows': minor
---

Workflow run list items now carry `has_started_job_execution`, reporting whether any job execution
of the attempt reached a runner. Run surfaces no longer show a client-derived `Queued` state: the
run list and run detail present the API attempt status and duration, and read the new flag to label
a finished run's duration as run or elapsed time.
