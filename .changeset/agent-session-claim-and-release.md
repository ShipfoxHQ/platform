---
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
"@shipfox/api-server": minor
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
---

Adds the agent session claim and carry-over inter-module methods (`claimSession`, `carryOverSessions`) with the session descriptor (`id`, `key`, `mode`, `segment`), so workflows can resume or fork a session and rerun attempts can carry sessions forward.

Session claims are released automatically on step-attempt and job termination, with a stale-claim reap cron as a backstop.

The previously required `jobLeaseTokenTtlSeconds` option on `createAgentModule` is removed; pass an optional `workflows` client to enable the job-terminated grace sweep.
