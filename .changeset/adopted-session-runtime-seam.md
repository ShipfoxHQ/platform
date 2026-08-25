---
"@shipfox/client-shell": minor
---

Adds `adoptSession` to enter an externally minted session that renews near expiry and falls back to the cookie session. Adds `releaseAdoptedSession` to end an adoption and restore the cookie session. Adds the optional `impersonatorId` to `AuthenticatedSession`.
