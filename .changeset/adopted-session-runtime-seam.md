---
"@shipfox/client-shell": minor
---

Adds the adopted-session runtime seam: `adoptSession` enters an externally minted session, suspends the cookie-based proactive refresh, and renews against the issuer clock near expiry; `releaseAdoptedSession` ends the adoption for the tab with a generation guard. Adds the optional `impersonatorId` to `AuthenticatedSession` and its session-mapper mapping.
