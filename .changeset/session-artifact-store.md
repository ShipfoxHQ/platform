---
"@shipfox/api-agent": patch
---

Adds the encrypted session transcript artifact store: per-commit objects at `agent-sessions/<workspace>/<run>/<session>/<segment>` sealed with the workspace envelope-crypto scheme (per-workspace DEK wrapped by the session KEK), a segment manifest (harness, SDK version, model, provider, committing attempt) stored as object metadata, the 64 MiB compressed blob cap, and the agent-owned retention sweep (expired rows after run termination plus the retention window, superseded segments pruned after a short grace, and orphans from a crash between write and head flip collected for unclaimed sessions).
