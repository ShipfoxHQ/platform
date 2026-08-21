---
"@shipfox/client-agent": patch
---

Agent provider onboarding now waits for the model provider catalog before showing provider and harness selection, with a loading state and a retryable error state when the catalog cannot be loaded.
