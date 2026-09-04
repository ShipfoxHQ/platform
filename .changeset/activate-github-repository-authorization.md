---
"@shipfox/api-integration-core": patch
---

Enforce GitHub repository authorization and expose repository-access settings in the integration module. Remove `INTEGRATIONS_ENABLE_REPOSITORY_AUTHORIZATION` from deployments because enforcement is now unconditional for GitHub. Other providers remain outside this cutover until they declare repository authorization support.
