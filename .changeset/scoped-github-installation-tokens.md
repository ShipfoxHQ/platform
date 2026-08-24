---
"@shipfox/api-integration-github": patch
"@shipfox/api-integration-core": patch
---

Adds optional `{repositoryId, permissions}` scoping to the GitHub installation token provider with a scope-keyed cache, plus installation-scoped repository resolution that fails as `access-denied`; existing agent-tools minting is unchanged.
