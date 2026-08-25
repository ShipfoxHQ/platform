---
"@shipfox/api-auth": minor
"@shipfox/api-auth-context": minor
"@shipfox/api-projects": minor
"@shipfox/api-runners": minor
"@shipfox/api-workspaces": minor
---

Adds the request-scoped `requireAdministrationActor` guard to `@shipfox/api-auth-context`, adopted positionally by every route group under an `/admin` prefix in the auth, projects, workspaces, and runners modules. An impersonated session (`UserContext` carrying `impersonatorId`) is rejected with the known `admin-role-required` failure before roles are consulted — including on the role-check-free first-owner bootstrap route — and any `/admin` surface added later inherits the guard from its prefix.
