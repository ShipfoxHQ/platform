---
"@shipfox/api-integration-linear-dto": minor
"@shipfox/api-integration-slack-dto": minor
"@shipfox/api-integration-jira-dto": minor
"@shipfox/api-integration-gitea-dto": minor
---

Adds an `IntegrationEventCatalog` to each provider DTO package, built from the event-name constants the webhook handlers parse against. The Gitea catalog lists the single `push` event the Gitea webhook handler publishes. The docs generator imports every catalog from its package.
