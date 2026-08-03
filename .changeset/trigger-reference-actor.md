---
"@shipfox/api-integration-spi": major
"@shipfox/api-integration-core-dto": major
"@shipfox/api-integration-github": minor
"@shipfox/api-integration-gitea": minor
---

Capture the actor that caused a source-control event on the normalized trigger reference. `TriggerReference` gains a required `actor`, resolved from the webhook sender by the GitHub and Gitea providers and null for payloads that name none.
