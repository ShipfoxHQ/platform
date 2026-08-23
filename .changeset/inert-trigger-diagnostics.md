---
"@shipfox/api-definitions": patch
---

Makes trigger-scoped validation errors inert: a broken trigger is excluded from the workflow model and reported as an error diagnostic with its path, while the definition and its other triggers keep syncing.
