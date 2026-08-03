---
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-core": patch
"@shipfox/api-integration-jira": major
"@shipfox/api-integration-spi": minor
"@shipfox/node-jwt": minor
"@shipfox/node-postgres": minor
---

Add Jira dynamic webhook registration and authenticated event ingestion through
the shared stored-webhook workflow. Update the SPI webhook request exports and
serialize Jira installation replacement across API replicas. Preserve Jira
delivery identifiers and require lifecycle callbacks for registration. Remove
the unused Jira webhook signing-secret configuration and allow HS256 verification
at a supplied receipt time.
