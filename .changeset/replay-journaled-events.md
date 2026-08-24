---
"@shipfox/api-triggers": minor
"@shipfox/api-triggers-dto": minor
---

Adds targeted replay to `POST /dev-runs` for integration-source triggers.
Requests may provide `replay_event_id` to use the recorded payload and integration connection.
Manual and scheduled triggers reject `replay_event_id`.
Refusals return `trigger-filtered` (409), `replay-event-mismatch` (409), `replay-event-not-found` (404), or `replay-event-unavailable` (410).
Development journal entries retain `replay_of_event_id` for each replay attempt.
