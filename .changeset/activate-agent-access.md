---
"@shipfox/api-agent-access": major
"@shipfox/api-agent-access-dto": major
"@shipfox/api-auth": major
"@shipfox/api-server": major
"@shipfox/client-agent": patch
"@shipfox/client-features": minor
---

Activates Agent Access OAuth, MCP tools, and settings in the default application composition.

`API_PUBLIC_URL` is required. Set it to the externally reachable API origin
before startup. Local development may use `http://localhost:16101`; staging and
production must use HTTPS.

Applications that previously appended `createOAuthRoutes`,
`createOAuthAuthorizationRoutes`, or `createAgentAccessManagementRoutes` to
`createAuthModule().routes` must remove those manual route groups. The standard
module composition now registers them, and composing them twice causes duplicate
Fastify route registration.
