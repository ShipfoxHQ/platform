---
"@shipfox/client-shell": minor
---

Serialize array search parameters as repeated keys instead of a JSON-encoded value, so multi-select filters read as `?status=failed&status=running` and survive values containing a comma.
