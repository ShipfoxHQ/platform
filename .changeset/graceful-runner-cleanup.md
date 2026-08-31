---
'@shipfox/api-runners': minor
---

Cancelled and timed-out runner jobs now acknowledge and finish downloading or uploading before termination, and keep their stop reason (user cancellation vs. maximum-duration timeout) intact.
