---
"@shipfox/api-auth": minor
"@shipfox/api-auth-context": minor
"@shipfox/api-projects": minor
"@shipfox/api-runners": minor
"@shipfox/api-workspaces": minor
---

Adds the `requireAdministrationActor` guard to `@shipfox/api-auth-context`. The guard rejects impersonated sessions (`UserContext` carrying `impersonatorId`) with the `admin-role-required` failure on every `/admin` route in the auth, projects, workspaces, and runners modules. It protects the first-owner bootstrap route before the system checks roles.
