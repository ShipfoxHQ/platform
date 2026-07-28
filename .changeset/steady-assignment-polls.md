---
"@shipfox/api-runners": patch
"@shipfox/api-runners-dto": minor
"@shipfox/runner-orchestration": patch
"@shipfox/runner-protocol": patch
---

Make managed runner assignment polling use an explicit bounded wait and retry transport timeouts while the control session remains healthy.
