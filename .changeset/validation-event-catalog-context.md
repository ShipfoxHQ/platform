---
"@shipfox/api-integration-spi": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-webhook-dto": minor
"@shipfox/api-integration-gitea": minor
"@shipfox/api-integration-gitea-dto": minor
"@shipfox/api-integration-github": minor
"@shipfox/api-integration-sentry": minor
"@shipfox/api-integration-slack": minor
"@shipfox/api-integration-jira": minor
"@shipfox/api-integration-linear": minor
"@shipfox/api-integration-webhook": minor
"@shipfox/api-definitions": minor
---

Exposes each provider's event catalog and the fixed-event providers on the integration validation context. Every provider now refuses the reserved `manual` and `cron` connection slugs.
