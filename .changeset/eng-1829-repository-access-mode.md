---
"@shipfox/api-integration-core": major
"@shipfox/api-integration-gitea": major
"@shipfox/api-integration-github": patch
"@shipfox/api-integration-github-dto": minor
"@shipfox/api-integration-spi": major
---

Persist per-connection repository access modes and manual repository grants.

The IntegrationConnection contract now requires `repositoryAccessMode`. Consumers
implementing or constructing connection values must add the field when upgrading
the core, Gitea, or SPI packages.
