---
'@shipfox/api-runners': minor
---

Move cancelled and timed-out runner termination to durable reconcile authorization after local cleanup; apply termination-reason gates and keep cleanup grace below STUCK_JOB_THRESHOLD_SECONDS.
