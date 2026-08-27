---
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/client-workflows": minor
---

Claims agent sessions at step dispatch and carries the session descriptor:

- Resolves the session key template at the step-dispatch context site with the same roots as the prompt and calls the agent-module `claimSession` before the step is handed to the runner. A `resume` claim that conflicts with a live attempt, a resolved harness that differs from the session's pinned harness, an invalid resolved key, or an unavailable session registry fails the attempt through the config-evaluation-failure path with one of the new step error reasons: `agent_session_key_invalid`, `agent_session_held`, `agent_session_harness_mismatch`, `agent_session_unavailable`.
- Embeds the resolved session descriptor `{id, key, mode, segment}` in the step dispatch config and exposes it as a typed nullable `session` field on the step DTO; the attempt config records the descriptor for the UI and audits.
