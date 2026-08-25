---
"@shipfox/api-agent": major
"@shipfox/api-agent-dto": major
"@shipfox/api-logs": major
"@shipfox/api-logs-dto": major
"@shipfox/node-object-storage": minor
"@shipfox/worktree-services": major
---

Replaces the logs-only `LOG_STORAGE_S3_*` base configuration with shared `OBJECT_STORAGE_S3_*` settings, per-consumer prefixes, and optional overrides, and adds encrypted agent-session transcript persistence. Self-hosters must migrate their S3 settings and provide `AGENT_SESSION_ENCRYPTION_KEK`; the DTO packages receive matching major versions for the API package-family release without DTO schema changes.
