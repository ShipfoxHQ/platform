---
"@shipfox/api-definitions": major
"@shipfox/api-definitions-dto": major
"@shipfox/client-projects": patch
"@shipfox/client-workflows": patch
---

Replaces published definition warning exports and the sync `warnings` field with severity-aware diagnostics, including workflow file paths for the workflows UI. The public diagnostics cap is named `DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT`.

This is a coordinated deployment contract change: the API, Temporal workers, and clients must be deployed together because the renamed wire fields do not include legacy fallbacks.
