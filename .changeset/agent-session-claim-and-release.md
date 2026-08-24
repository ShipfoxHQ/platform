---
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
"@shipfox/api-server": minor
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
---

Adds the agent session claim and carry-over inter-module methods with the session descriptor, and releases session claims on step-attempt and job termination events with a stale-claim reap cron.

`createAgentModule` gains an optional `workflows` client: when it is absent, the claim-release subscribers and worker are not registered, so existing callers keep the module claim/release-free. `@shipfox/api-server`'s `DefaultAgentModuleFactory` passes the workflows client through the same optional option; the previous required `jobLeaseTokenTtlSeconds` factory option is removed (its only use was a startup validation whose lease-TTL premise was incorrect).

**Rollout notes**
- Deploy the Agent and Workflows packages together: the job-terminated grace sweep calls the new `listJobStepAttempts` workflows inter-module method, and mixed-version compositions fail at the inter-module composition boundary.
- `AGENT_SESSION_REAP_AFTER_SECONDS` (default 8 hours) must exceed the longest job execution duration for the deployment (workflows' default maximum is 6 hours). The job lease is renewable on every runner heartbeat, so claim age is only a backstop heuristic — the reaper is not a liveness signal. Unsafe values log a startup warning instead of failing boot.
- `AGENT_SESSION_CLOSE_GRACE_SECONDS` must be positive (clamped to a minimum of 1s); the sweep releases claims of a terminated job's step attempts after the grace window.
- `AGENT_SESSION_REAP_BATCH_LIMIT` (default 100) bounds each cron tick.
- After a rollback, terminate any started `agent-session-release:*` workflows; release workflows now carry a 1-hour execution timeout.
- The step-attempt release is delivered asynchronously through the outbox and is not ordered against the next synchronous claim; the upcoming dispatch consumer must tolerate `session-held` with a short bounded retry.
