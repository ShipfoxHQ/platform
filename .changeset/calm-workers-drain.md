---
"@shipfox/node-module": patch
---

Avoids duplicate Temporal worker shutdown requests when signal handling has already started draining workers.
