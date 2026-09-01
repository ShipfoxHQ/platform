---
'@shipfox/api-definitions': minor
'@shipfox/workflow-document': minor
---

Enables authoring integration tool steps with literal tool references, JSON inputs, and result output mappings. Deploy the validation API and editor schema together: older API builds reject tool-step fields, and rolling back after tool-step definitions are saved will make those definitions fail validation until this release is restored.
