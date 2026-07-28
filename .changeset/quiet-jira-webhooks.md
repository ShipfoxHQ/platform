---
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-core": patch
"@shipfox/api-integration-jira": major
"@shipfox/api-integration-spi": minor
"@shipfox/node-jwt": minor
"@shipfox/node-postgres": minor
---

Add Jira dynamic webhook registration and authenticated event ingestion through the shared stored-webhook pipeline. Update the SPI re-exported webhook request surface, serialize Jira installation replacement across API replicas, preserve Jira delivery identifiers, and require lifecycle callbacks for registration. Remove the unused Jira webhook signing-secret configuration and allow HS256 verification at a supplied receipt time.
