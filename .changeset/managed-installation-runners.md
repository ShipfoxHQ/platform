---
"@shipfox/api-runners-dto": minor
"@shipfox/api-runners": patch
"@shipfox/client-runners": patch
---

Adds `installation_runners` (`managed` or `none`) to the active-provisioners response. The value is `managed` when reserved runner labels are configured or an installation-scope provisioner token is active, so clients can omit the runner setup row when the installation already provides capacity.
