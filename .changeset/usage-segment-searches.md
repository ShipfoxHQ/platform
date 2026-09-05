---
"@shipfox/api-usage": minor
"@shipfox/api-usage-dto": minor
---

Adds web-search quantities to Usage segments and exports shared per-dialect token-class normalization.

Roll out Usage consumers before producers. Drain the Usage outbox before rollback. If rollback follows new event writes, redeploy this version before replaying those events.
