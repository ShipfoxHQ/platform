---
"@shipfox/api-agent-dto": patch
---

Rejects the per-step `claude` runtime block when attached to reserved model provider ids such as `anthropic`; the block is only accepted alongside a managed (non-reserved) provider id.
