---
"@shipfox/api-auth-context": minor
"@shipfox/api-runners": minor
"@shipfox/api-workspaces": minor
---

Adds `rejectImpersonatedSession` to `@shipfox/api-auth-context`, which throws `impersonation-not-permitted` when the request's user context carries an `impersonatorId`. The runner manual-registration-token, provisioner-token, and workspace invitation creation routes now reject impersonated sessions, so an impersonated session cannot leave behind a credential or durable grant that outlives its bounded token window.
