---
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-core": patch
---

Adds provider capabilities to the `integrations.connection.available` event, so subscribers can tell a tool connection from a source-control connection. The publisher now carries the capabilities the connection DTO already exposes.
