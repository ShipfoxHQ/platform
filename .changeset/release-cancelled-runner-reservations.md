---
"@shipfox/api-runners": major
"@shipfox/api-runners-dto": major
"@shipfox/api-workflows": patch
"@shipfox/api-workflows-dto": major
---

Replace synchronous runner scheduling and lease-finalization commands with ordered job-execution queue and terminal facts, then converge terminal runner reservations from the resulting lease state.
