---
"@shipfox/api-auth": minor
"@shipfox/api-auth-dto": minor
---

Adds the impersonation mint command and admin route: `POST /admin/auth/users/:user_id/impersonate` mints a short-lived, marked, audited impersonated session for an active, verified, non-administrator user. The command enforces the authorization and eligibility ladder (opt-in `AUTH_IMPERSONATION_ENABLED` flag defaulting to `false`, `admin-operator` minimum, no impersonated actor, no self-target, active verified target, no active administrator grant on the target), stores only SHA-256 fingerprints of issued tokens in the idempotency result, re-runs the ladder on in-window replays (re-signing with the original expiry), and publishes `administration.action.performed` events for mints, replays, and failures. The response DTO `impersonateResponseSchema` carries `token`, `expires_at`, `server_time`, `impersonator_id`, and the target user.
