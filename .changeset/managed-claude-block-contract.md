---
"@shipfox/api-agent-dto": patch
---

Enforces the runtime-credentials contract at the schema boundary: the per-step `claude` runtime block is only accepted alongside a managed (non-reserved) model provider id, so the block cannot be attached to reserved providers such as `anthropic`.
