# Shipfox API Integration Gitea

Shipfox API Integration Gitea connects a Gitea organization to a Shipfox
workspace, receives organization push webhooks, and lets workflow runners check
out repositories through Gitea's git HTTP endpoint. It also exposes a minimal
agent tool catalog over the same Gitea REST API.

## What it does

- **`GiteaSourceControlProvider`** lists repositories, reads files, resolves
  refs, and prepares checkout credentials.
- **`GiteaAgentToolsProvider`** exposes issue reads and issue comments through
  the `agent_tools` capability.
- **`giteaAgentToolCatalog`** describes the `get_issue` and `comment_on_issue`
  tools and their read or write scope.

## Installation and setup

Configure the provider in the API environment. The service token needs
`read:issue` permission for `get_issue` and `write:issue` permission for
`comment_on_issue`.

```sh
GITEA_BASE_URL=https://gitea.example.com
GITEA_SERVICE_USERNAME=shipfox-bot
GITEA_SERVICE_TOKEN=
GITEA_WEBHOOK_SECRET=
GITEA_CHECKOUT_TTL_SECONDS=300
```

`GITEA_BASE_URL` is the URL the API uses for Gitea REST calls and webhook
setup.

`GITEA_SERVICE_USERNAME` and `GITEA_SERVICE_TOKEN` are handed to runners as
checkout credentials. The checkout spec keeps these credentials separate from
the repository URL.

`GITEA_WEBHOOK_SECRET` must match the secret configured on the Gitea
organization webhook.

## Usage

Read an issue through the public package client:

```ts
import {createGiteaApiClient} from '@shipfox/api-integration-gitea';

const client = createGiteaApiClient();
const issue = await client.getIssue({owner: 'shipfox', repo: 'platform', index: 12});
console.log(issue.title);
```

## Behavior notes

The connection is organization-scoped. The provider injects the connected
organization as `owner`, so tools accept `repo`, `index`, and `body` only.

`comment_on_issue` is an at-least-once write. A timeout can commit a comment
before the response arrives, so inspect the issue before retrying an ambiguous
call. Comment bodies are Markdown and are limited to 12,000 characters.

Issue content comes from Gitea users. Treat issue titles and bodies as untrusted
agent input.

## Clone URL Override

By default, checkout uses the clone URL reported by Gitea for each repository.
Set `GITEA_CLONE_BASE_URL` when runners reach Gitea through a different scheme,
host, or port than the API does:

```sh
GITEA_BASE_URL=http://localhost:3000
GITEA_CLONE_BASE_URL=http://gitea:3000
```

When set, the provider rewrites only the clone URL origin and keeps the
repository path reported by Gitea. Repository listing, `htmlUrl`, REST API calls,
and webhooks continue to use `GITEA_BASE_URL`.

## Development

Run checks for this package:

```sh
turbo check --filter=@shipfox/api-integration-gitea
turbo type --filter=@shipfox/api-integration-gitea
turbo test --filter=@shipfox/api-integration-gitea
```

For repository test conventions, read the
[testing guide](../../../../docs/guides/testing.md). This package uses the
`api_test` database, set in `test/env.ts`.

## License

MIT
