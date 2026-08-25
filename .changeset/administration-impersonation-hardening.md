---
"@shipfox/api-auth": minor
"@shipfox/api-auth-context": minor
"@shipfox/api-projects": minor
"@shipfox/api-runners": minor
"@shipfox/api-workspaces": minor
---

Adds the `requireAdministrationActor` guard to `@shipfox/api-auth-context`, which rejects an impersonated session (`UserContext` carrying `impersonatorId`) with the `admin-role-required` failure on every `/admin` route in the auth, projects, workspaces, and runners modules — including the first-owner bootstrap route — before roles are consulted.
