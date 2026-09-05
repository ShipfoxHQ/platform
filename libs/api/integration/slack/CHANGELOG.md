# @shipfox/api-integration-slack

## 22.0.0

### Patch Changes

- @shipfox/api-integration-slack-dto@22.0.0
- @shipfox/api-integration-spi@4.1.1

## 21.2.0

### Patch Changes

- Updated dependencies [5e123f1]
  - @shipfox/api-integration-spi@4.1.0

## 21.0.0

### Patch Changes

- Updated dependencies [5886bf2]
  - @shipfox/api-integration-spi@4.0.0
  - @shipfox/api-integration-slack-dto@21.0.0

## 20.4.0

### Patch Changes

- Updated dependencies [0b32d1a]
  - @shipfox/api-auth-context@20.4.0

## 20.2.0

### Patch Changes

- Updated dependencies [ba481d6]
- Updated dependencies [be556f0]
  - @shipfox/node-fastify@0.4.4
  - @shipfox/api-integration-spi@3.0.2
  - @shipfox/api-auth-context@20.2.0

## 20.1.0

### Patch Changes

- Updated dependencies [2bf937b]
  - @shipfox/api-auth-context@20.1.0
  - @shipfox/api-integration-slack-dto@20.1.0
  - @shipfox/api-integration-spi@3.0.1

## 20.0.0

### Patch Changes

- Updated dependencies [ec39327]
- Updated dependencies [09b8e1e]
- Updated dependencies [351f02c]
  - @shipfox/api-integration-spi@3.0.0
  - @shipfox/api-auth-context@20.0.0
  - @shipfox/api-integration-slack-dto@20.0.0

## 19.0.0

### Patch Changes

- b416c4c: Preserves existing package behavior while simplifying internal control flow.
- Updated dependencies [b416c4c]
- Updated dependencies [a52cd6d]
  - @shipfox/api-auth-context@19.0.0
  - @shipfox/api-integration-spi@2.2.0
  - @shipfox/api-integration-slack-dto@19.0.0
  - @shipfox/api-workspaces-dto@15.0.0
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-fastify@0.4.3
  - @shipfox/node-opentelemetry@0.6.5
  - @shipfox/node-postgres@0.5.1

## 18.0.0

### Patch Changes

- Updated dependencies [b2aad90]
  - @shipfox/api-integration-spi@2.1.0
  - @shipfox/api-auth-context@18.0.0
  - @shipfox/api-integration-slack-dto@18.0.0

## 17.0.0

### Patch Changes

- Updated dependencies [a4f56ff]
- Updated dependencies [a591e8a]
- Updated dependencies [9f898d9]
  - @shipfox/api-auth-context@17.0.0
  - @shipfox/node-postgres@0.5.1

## 16.0.0

### Patch Changes

- @shipfox/api-integration-slack-dto@16.0.0
- @shipfox/api-integration-spi@2.0.2

## 15.0.0

### Patch Changes

- @shipfox/node-opentelemetry@0.6.5
- @shipfox/api-workspaces-dto@15.0.0
- @shipfox/api-integration-slack-dto@15.0.0
- @shipfox/api-integration-spi@2.0.1
- @shipfox/node-fastify@0.4.3
- @shipfox/api-auth-context@15.0.0

## 14.0.0

### Minor Changes

- 1b71a66: Exposes each provider's event catalog and the fixed-event providers on the integration validation context. Every provider now refuses the reserved `manual` and `cron` connection slugs.

### Patch Changes

- Updated dependencies [18e9bad]
- Updated dependencies [2323e2e]
- Updated dependencies [1b71a66]
  - @shipfox/api-integration-spi@2.0.0
  - @shipfox/api-integration-slack-dto@14.0.0

## 12.5.0

### Patch Changes

- Updated dependencies [f2b20af]
  - @shipfox/api-integration-spi@1.1.1

## 12.3.0

### Patch Changes

- Updated dependencies [e0110fe]
  - @shipfox/api-integration-spi@1.1.0

## 12.2.0

### Patch Changes

- @shipfox/api-integration-slack-dto@12.2.0
- @shipfox/api-integration-spi@1.0.1
- @shipfox/node-opentelemetry@0.6.4
- @shipfox/node-fastify@0.4.2
- @shipfox/api-auth-context@12.2.0

## 12.0.0

### Minor Changes

- a018f92: Expose the Linear and Slack agent-tool catalogs for integration documentation generation.

### Patch Changes

- f78740d: Remove Unicode dash punctuation from package prose and source comments.
- Updated dependencies [f78740d]
- Updated dependencies [94aba88]
- Updated dependencies [24ef475]
- Updated dependencies [f13e8bb]
- Updated dependencies [9ebc5b4]
- Updated dependencies [869a792]
- Updated dependencies [54c820e]
- Updated dependencies [e1efaee]
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-fastify@0.4.1
  - @shipfox/api-workspaces-dto@12.0.0
  - @shipfox/api-integration-spi@1.0.0
  - @shipfox/node-postgres@0.5.0
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/api-integration-slack-dto@12.0.0
  - @shipfox/node-drizzle@0.3.5

## 11.0.0

### Major Changes

- 4661bce: Rename the Slack agent tools to match the Slack MCP server and add channel metadata, channel members, scheduled messages, and canvas creation. Tool ids and parameters now follow the MCP naming (`read_thread`, `send_message`, `channel_id`, `message_ts`, `message`), messages are written as standard Markdown, and workflows selecting the previous ids have to be updated. `send_message`, `schedule_message`, and `update_message` now reject a message over Slack's 12,000-character Markdown block limit instead of forwarding it and failing, and their notification fallback text has Markdown syntax stripped instead of shown literally. Slack installations need reauthorization for the added `canvases:write`, `im:read`, `mpim:read`, and `mpim:history` scopes. `SLACK_TOOL_OPERATIONS` and the `SlackToolOperation` type are no longer exported from the package root; they are Web-API wire-mapping internals with no consumer outside this package, and the Linear and GitHub integration packages never exported their equivalents either.

### Patch Changes

- Updated dependencies [25158c8]
  - @shipfox/api-auth-context@11.0.0
  - @shipfox/api-workspaces-dto@11.0.0

## 10.2.0

### Patch Changes

- Updated dependencies [07e7371]
  - @shipfox/api-workspaces-dto@10.2.0
  - @shipfox/api-auth-context@10.2.0

## 10.1.0

### Patch Changes

- @shipfox/api-auth-context@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [74f9e31]
- Updated dependencies [e9280fc]
  - @shipfox/node-fastify@0.4.0
  - @shipfox/api-workspaces-dto@10.0.0
  - @shipfox/api-auth-context@10.0.0
  - @shipfox/api-integration-slack-dto@9.0.2
  - @shipfox/api-integration-spi@0.2.2
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-postgres@0.4.4

## 9.3.0

### Patch Changes

- Updated dependencies [4425c6d]
- Updated dependencies [7b6a409]
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/api-workspaces-dto@9.3.0
  - @shipfox/api-auth-context@9.3.0
  - @shipfox/node-fastify@0.3.4

## 9.2.0

### Patch Changes

- @shipfox/api-workspaces-dto@9.2.0
- @shipfox/api-auth-context@9.2.0

## 9.0.3

### Patch Changes

- @shipfox/node-fastify@0.3.3
- @shipfox/api-auth-context@9.0.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-auth-context@9.0.2
  - @shipfox/api-integration-slack-dto@9.0.2
  - @shipfox/api-integration-spi@0.2.2
  - @shipfox/api-workspaces-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-fastify@0.3.2
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/node-postgres@0.4.4

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/api-integration-slack-dto@9.0.1
  - @shipfox/api-integration-spi@0.2.1
  - @shipfox/api-workspaces-dto@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/inter-module@0.2.1
  - @shipfox/node-drizzle@0.3.3
  - @shipfox/node-fastify@0.3.1
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-postgres@0.4.3

## 9.0.0

### Patch Changes

- 4a6d124: Separates Integrations provider SPI contracts from the public DTO surface.
- Updated dependencies [9c9d266]
- Updated dependencies [4a6d124]
  - @shipfox/api-workspaces-dto@9.0.0
  - @shipfox/api-integration-spi@0.2.0
  - @shipfox/api-auth-context@9.0.0
  - @shipfox/api-integration-slack-dto@9.0.0
  - @shipfox/config@1.2.2
  - @shipfox/inter-module@0.2.0
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-postgres@0.4.2

## 8.0.0

### Patch Changes

- Updated dependencies [7f227c6]
  - @shipfox/api-integration-core-dto@8.0.0
  - @shipfox/api-integration-slack-dto@8.0.0

## 7.1.0

### Patch Changes

- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/api-auth-context@7.1.0

## 6.0.0

### Minor Changes

- 40a6e0f: Adds shared processing for signed Slack event and command webhook deliveries.
- f262539: Adds a composed webhook processor and optional provider-neutral delivery source for hosted API runtimes.
- a42b575: Exposes Secrets through its inter-module contract and migrates Agent, integrations, and Workflows consumers.

### Patch Changes

- 3bb4e26: Fixes composed webhook processing and exposes Slack URL-verification responses through the shared contract.
- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- 326f4c0: Exposes Workspaces inter-module operations and moves Auth and OAuth providers onto injected clients.
- 1820feb: Adds Slack Settings installation and callback recovery while returning stable workspace access errors.
- Updated dependencies [0bb82a4]
- Updated dependencies [7ac43a4]
- Updated dependencies [f262539]
- Updated dependencies [3bb4e26]
- Updated dependencies [1b79cda]
- Updated dependencies [c2db8c3]
- Updated dependencies [8bdc149]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [326f4c0]
- Updated dependencies [4a91956]
- Updated dependencies [81f9544]
- Updated dependencies [4604a06]
  - @shipfox/api-integration-core-dto@6.0.0
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/api-workspaces-dto@6.0.0
  - @shipfox/api-auth-context@6.0.0
  - @shipfox/node-fastify@0.2.4
  - @shipfox/inter-module@0.2.0
  - @shipfox/api-integration-slack-dto@6.0.0

## 5.0.0

### Minor Changes

- 2875241: Adds deduplicated Slack installation revocation for app uninstall and bot token-revocation events.
- fb70438: Cascades provider installation and token deletion when removing a connection.

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [2875241]
- Updated dependencies [bb037af]
- Updated dependencies [fb70438]
  - @shipfox/api-integration-slack-dto@5.0.0
  - @shipfox/api-integration-core-dto@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-secrets@5.0.0
  - @shipfox/api-workspaces@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-postgres@0.4.2

## 4.0.0

### Minor Changes

- 67176d4: Adds the Slack OAuth connection flow with provider routes, secure bot-token storage, and E2E setup.
- 7267872: Adds signed Slack Events API and slash-command receivers that publish normalized integration events without persisting command verification tokens.
- bbba3b7: Adds the Slack integration provider scaffold with installation storage, bot-token custody, and flag-gated registration.

### Patch Changes

- 0745ee9: Prevents Slack bot tokens from being read for revoked, expired, or missing installations.
- 23c8e4d: Rejects Slack OAuth grants that enable unsupported token rotation.
- 1951293: Adds in-process Slack agent tools for reading conversations and acting on messages through the lease-authenticated gateway.
- Updated dependencies [dda7c54]
- Updated dependencies [7267872]
- Updated dependencies [bbba3b7]
  - @shipfox/api-integration-slack-dto@4.0.0
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-secrets@4.0.0
  - @shipfox/api-workspaces@4.0.0
