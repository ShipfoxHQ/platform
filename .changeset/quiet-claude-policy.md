---
"@shipfox/runner-agent": patch
---

Keep Claude agent steps isolated from repository-controlled policy and fail when the requested permission mode is downgraded. Repository settings, hooks, MCP discovery, and automatic memory are no longer loaded; `CLAUDE.md` and `AGENTS.md` are read only from the working directory, capped at 64 KiB, and appended as advisory prompt text without parent walking or `@path` expansion. This intentionally loosens behavior for repositories that used project settings to restrict CI agents.
