---
"@shipfox/api-triggers": minor
"@shipfox/api-triggers-dto": minor
---

Adds targeted replay to `POST /dev-runs`: an integration-source trigger now accepts `replay_event_id` and replays the journaled event with its stored payload and connection, evaluating the trigger filter exactly as dispatch does. Refusals answer `trigger-filtered` with the reason (409), mismatched events `replay-event-mismatch` (409), missing rows `replay-event-not-found` (404), and pruned payloads `replay-event-unavailable` (410); the dev journal row records `replay_of_event_id` and the replayed payload. The request body schema in `@shipfox/api-triggers-dto` gains the optional `replay_event_id`.
