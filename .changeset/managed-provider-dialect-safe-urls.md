---
"@shipfox/api-agent": major
"@shipfox/api-agent-dto": major
---

Defines managed-provider `baseUrl` as a gateway mount root and normalizes it
for the client URL semantics of each API dialect. Providers that previously
returned client-ready bases must migrate to return the gateway root before
upgrading.
