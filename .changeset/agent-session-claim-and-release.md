---
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
"@shipfox/api-server": minor
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
---

Adds the agent session claim and carry-over inter-module methods (`claimSession`, `carryOverSessions`) with the session descriptor (`id`, `key`, `mode`, `segment`), so workflows can resume or fork a session and rerun attempts can carry sessions forward.

Session claims are released automatically on step-attempt and job termination, with a stale-claim reap cron as a backstop; all releases are guarded and idempotent.

`createAgentModule` gains an optional `workflows` client: the step-attempt release and reap cron are always registered, and the job-terminated grace sweep is registered only when the client is present, so existing callers can keep the module claim/release-free. `@shipfox/api-server`'s `DefaultAgentModuleFactory` forwards the client; the previous required `jobLeaseTokenTtlSeconds` factory option is removed.
