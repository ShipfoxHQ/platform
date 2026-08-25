---
"@shipfox/api-auth": minor
"@shipfox/api-auth-dto": minor
---

Adds the impersonation mint command and admin route: `POST /admin/auth/users/:user_id/impersonate` mints a short-lived, marked, audited impersonated session for an active, verified, non-administrator user, gated behind the opt-in `AUTH_IMPERSONATION_ENABLED` flag (defaults to `false`). The response DTO `impersonateResponseSchema` carries `token`, `expires_at`, `server_time`, `impersonator_id`, and the target user.
