---
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-server": patch
"@shipfox/api-workflows": patch
---

Adds the repository authorization contract with exact-ID/name target resolution and its authorization error codes. Checkout now surfaces repository-authorization failures as not-granted (404), ambiguous (409), and store-unavailable (503) errors.
