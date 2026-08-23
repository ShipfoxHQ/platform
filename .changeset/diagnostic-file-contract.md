---
"@shipfox/api-definitions": major
"@shipfox/api-definitions-dto": major
"@shipfox/client-projects": patch
"@shipfox/client-workflows": patch
---

Replaces published definition warning exports and the sync `warnings` field with severity-aware diagnostics, including workflow file paths for the workflows UI.

Consumers must migrate from `warnings` to `diagnostics`; this release does not provide a legacy-field fallback.
