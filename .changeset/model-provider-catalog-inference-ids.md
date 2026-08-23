---
"@shipfox/api-agent-dto": minor
"@shipfox/api-agent": patch
"@shipfox/client-agent": minor
---

Adds `managed_provider_id` and `instance_default_provider_id` to the model-provider catalog response, so clients can tell when the installation already provides inference (a registered managed provider or `AGENT_DEFAULT_PROVIDER`) and hide the model-provider setup row. `managedProviderFromCatalog` now reads the managed provider id and also resolves the managed entry in a mixed catalog; `isManagedOnlyCatalog` keeps its current meaning.
