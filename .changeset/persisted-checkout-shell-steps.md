---
"@shipfox/runner-execution": patch
"@shipfox/runner-orchestration": patch
---

Forward the ambient Git config a persisted checkout writes to shell run steps. A later `run` step then commits and pushes with the checkout author identity and repository-scoped credential.
