---
"@shipfox/client-workflows": minor
"@shipfox/client-triggers": minor
---

Adds client adapters and hooks for dev runs: listing workflow definitions at a git ref with the pinned commit, creating a dev run with an optimistic pending row in the project run lists and translated route errors, and filtering trigger events by origin and replayability for the event picker. Integration-trigger replays use the API's `replay_event_id` support.
