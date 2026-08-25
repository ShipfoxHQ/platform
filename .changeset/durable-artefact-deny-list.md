---
"@shipfox/api-auth-context": minor
"@shipfox/api-runners": minor
"@shipfox/api-workspaces": minor
---

Adds the D6 durable-artefact deny-list: `rejectImpersonatedSession` in `@shipfox/api-auth-context` throws the known failure `impersonation-not-permitted` when the request's user context carries an `impersonatorId`, and the runner manual-registration-token, provisioner-token, and workspace invitation creation routes adopt it. An impersonated session cannot leave behind a credential or durable grant that outlives its bounded token window.
