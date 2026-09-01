---
"@shipfox/api-workflows": patch
"@shipfox/api-workflows-dto": minor
---

Adds checkout credential renewal to the setup checkout-token response via `refresh-at`/`on-rejection` renewal modes and accepts an optional `rejected_generation` when renewing.
