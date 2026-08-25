---
"@shipfox/runner-agent": patch
---

Allows the Claude harness to run managed providers that carry a per-step claude runtime block, preserving the managed provider ID for policy and usage attribution. The block is validated at the harness gate (malformed blocks fail with a config error), and the managed auth token is masked alongside runtime credentials in step logs.
