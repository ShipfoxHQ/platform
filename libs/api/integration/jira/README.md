# Jira integration

Jira OAuth, site links, token storage, webhooks, and token upkeep for Shipfox.

## What it does

- **`createJiraIntegrationProvider`** builds Jira OAuth and webhook routes.
- **`createJiraTokenStore`** stores Jira access and refresh tokens.
- **`createJiraMaintenanceWorker`** runs the token refresh workflow.
- **Installation functions** store Jira sites, webhooks, and token dates.

## Token upkeep

The worker runs every six hours.

It checks active sites in small batches. It refreshes a token after 76 idle days. Jira refresh tokens expire after about 90 idle days. The 14-day lead gives time for recovery.

A rejected refresh token or timeout marks the link as `error`. The user must connect Jira again. A new OAuth flow clears this state.

## Installation and setup

```sh
pnpm add @shipfox/api-integration-jira
```

The host supplies OAuth config, secret storage, connection lookup, and database access.

## Usage

```ts
import {createJiraIntegrationProvider} from '@shipfox/api-integration-jira';

const provider = createJiraIntegrationProvider();

console.log(provider.provider); // "jira"
```

The composed integrations module supplies route and worker dependencies.

## Behavior notes

Connect Jira with a dedicated Shipfox service account. Jira 3LO actions use the authorizing account. Events from that account are dropped to prevent agent self-triggering.

## Data model

The package owns the `integrations_jira_installations` table. The `refresh_token_last_used_at` column records the last successful refresh-token use. The `refresh_token_last_attempted_at` column rotates maintenance attempts so failed or inactive connections cannot starve the capped sweep.

## Development

```sh
mise exec -- turbo check --filter=@shipfox/api-integration-jira
mise exec -- turbo type --filter=@shipfox/api-integration-jira
mise exec -- turbo test --filter=@shipfox/api-integration-jira
mise exec -- turbo build --filter=@shipfox/api-integration-jira
```

Database tests need the local PostgreSQL test service.

## License

MIT
