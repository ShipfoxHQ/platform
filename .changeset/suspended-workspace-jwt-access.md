---
"@shipfox/api-auth": major
"@shipfox/api-auth-context": patch
"@shipfox/api-workspaces-dto": patch
"@shipfox/api-workspaces": patch
---

Carry workspace lifecycle status in JWT membership claims and enforce suspended or inactive access at the stateless workspace gate while keeping access-token verification stateless.

`getAuthenticatedSessionContext()` now reads refresh-session metadata from verified access-token claims without checking active refresh-session state; revoking a refresh session does not invalidate an already-issued access token.
