---
"@shipfox/runner-execution": patch
"@shipfox/runner-orchestration": patch
---

Forward the ambient Git config a persisted checkout writes to shell run steps, so a later `run` step commits and pushes with the checkout author identity and repository-scoped credential.
