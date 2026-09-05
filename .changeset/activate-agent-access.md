---
"@shipfox/api-agent-access": major
"@shipfox/api-agent-access-dto": major
"@shipfox/api-auth": major
"@shipfox/api-auth-context": minor
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

Applications that replace the standard Auth module with `authModuleFactory`
must register `AUTH_AGENT_ACCESS`. Include the `createAgentAccessAuthMethod`
export from `@shipfox/api-auth` in the replacement module's auth methods so the
default MCP route can authenticate agent-access credentials.

After deployment, fetch
`$API_PUBLIC_URL/.well-known/oauth-authorization-server` and verify that its
issuer and endpoint origins match `API_PUBLIC_URL`.
