---
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-gitea": minor
"@shipfox/api-integration-github": minor
"@shipfox/api-integration-spi": minor
"@shipfox/api-projects": patch
"@shipfox/api-projects-dto": major
"@shipfox/api-workflows": patch
---

Projects checkout resolution now requires a project ID and no longer accepts repository names. Checkout requests authorize the repository target before issuing credentials. Repository declarations remain valid without a project association.
