# Shipfox API Integration Linear

Shipfox API Integration Linear provides the Linear provider foundation, OAuth
routes, signed webhook ingestion, hosted MCP adapter, and agent tool catalog. It
is currently enabled behind `INTEGRATIONS_ENABLE_LINEAR_PROVIDER`.

## OAuth callback

Set `LINEAR_OAUTH_REDIRECT_URL` to the public client callback, for example
`https://shipfox.example.com/integrations/linear/callback`. The client forwards
the signed callback query to the authenticated API endpoint, while the API uses
the same configured URL during the server-side token exchange.

## Webhooks

Linear sends OAuth application webhooks to:

```text
POST /webhooks/integrations/linear
```

The receiver requires `LINEAR_WEBHOOK_SIGNING_SECRET` to match the signing secret
configured on the Linear app. It verifies `Linear-Signature` against the raw
request body before parsing JSON, rejects signed payloads whose
`webhookTimestamp` is more than 60 seconds from the API server clock, and uses
the `Linear-Delivery` header as the integration delivery id.

The OAuth app manifest is the canonical webhook configuration. Configure its
initial webhook resource types as `Issue`, `Comment`, `IssueLabel`, `Project`,
`Cycle`, and `AgentSessionEvent`; Linear applies that app-level configuration
when an organization authorizes the app. Shipfox does not issue a runtime
`webhookCreate` mutation, and there are no earlier installed organizations to
migrate. See [Linear's OAuth app manifests](https://linear.app/developers/oauth-app-manifests).

Supported data webhook events are `Issue`, `Comment`, `IssueLabel`, `Project`,
and `Cycle` with `create`, `update`, or `remove` actions. They publish
`integrations.event.received` with `provider: "linear"`, `source:
connection.slug`, and event names such as `Issue.create`.

`AgentSessionEvent.created` publishes `agentSession.created` for both an
assignment and a comment mention. The raw payload is preserved, including
`agentSession.commentId` and `agentSession.sourceCommentId`, so workflow filters
can distinguish the context. Authors can get the Linear app user id from an
observed event or the Linear app identity, then compare it with `appUserId` in a
filter literal. `AgentSessionEvent.prompted` publishes `agentSession.prompted`;
it can start a subscribed workflow or reach an explicitly configured job listener,
but never automatically resumes a run from its AgentSession. The module does not
acknowledge sessions or emit Linear agent activities. See [Linear's agent-session
behavior](https://linear.app/developers/agent-interaction).

Signed but unsupported webhook shapes are recorded and dropped with a 200
response so Linear does not retry or disable the webhook endpoint.
## Agent Tool Catalog

The catalog of Linear agent tools in v1 covers the broader workspace through Linear's
hosted MCP tool ids. It includes read tools for issues, comments, projects,
documents, teams, users, cycles, releases, release notes, release pipelines,
agent skills, diffs, documentation search, and attachments. It also includes
write tools for issue and comment workflows plus project, document, milestone,
release, release note, label, status update, comment, and attachment mutation.

Tool ids intentionally match Linear's hosted MCP server exactly. The catalog is
the local source of truth for authoring validation, write-safety metadata, and
future audit behavior; the provider advertises `agent_tools` and proxies calls
to Linear's hosted MCP server with the connection's stored Linear token.

Sensitivity policy:

- `save_issue` is explicitly `sensitive: false`. It is still a write tool and
  requires `allow_write`, but the v1 product choice treats normal issue triage as
  an ordinary write.
- `save_comment` is `sensitive: false`.
- Destructive or workspace-shaping writes are `sensitive: true`, including
  upload and delete tools, status update mutation, project/document/milestone
  saves, release/release-note saves, and label creation.
- Attachment upload tools are included with their native hosted-MCP names:
  `prepare_attachment_upload`, `create_attachment_from_upload`, and the
  deprecated tiny-file fallback `create_attachment`.

## Development

Run checks for this package:

```sh
turbo check --filter=@shipfox/api-integration-linear
turbo type --filter=@shipfox/api-integration-linear
turbo test --filter=@shipfox/api-integration-linear
```
