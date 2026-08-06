---
"@shipfox/api-runners": patch
---

Allow idle runners with expired or deleted intended or assigned reservations to be rebound on the next demand poll. Runner reports no longer overwrite a committed reservation assignment, and rebinding revokes unconsumed activation tokens before transferring ownership.
