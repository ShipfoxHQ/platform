---
"@shipfox/api-integration-jira": patch
---

Adds a six-hour Jira refresh-token maintenance worker that refreshes idle tokens, records refresh attempts so failed or inactive connections cannot starve its capped sweep, and migrates existing installations with backfilled refresh state. Token access now fails closed for non-active connections, and rejected refresh tokens or ambiguous refresh timeouts require reconnecting Jira.
