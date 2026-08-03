# @shipfox/e2e-driver-gitea

The integration/gitea domain end to end for E2E suites. It drives the external Gitea
instance with admin credentials (org, team, webhook, repos, commits) and links the org
to a workspace through the product route. One import gives a scenario a connected org.

Calling Gitea's REST API directly is on purpose: Gitea is the external system under
integration, exactly like the browser is for client E2E. Everything else goes through
the platform's public HTTP surface.

## Public API

Instance side (admin-credentialed, against `E2E_GITEA_URL`):

- `createOrg(params?)`: org + read-only team (`includes_all_repositories`) + bot
  membership + org push webhook, mirroring `dev/gitea/bootstrap.sh`. Returns
  `{org, teamId, webhookId}`. A fresh org per suite run is required because an org can
  only ever be linked to one workspace.
- `createRepo({org, name, ...})`: create a repo in the org. Returns `{name, fullName,
  cloneUrl, defaultBranch}`.
- `commitFiles({org, repo, message, files, branch?})`: one commit for the whole batch
  through Gitea's change-files contents API. Returns the commit SHA. File `content` is
  UTF-8 text; the helper base64-encodes it. `operation` defaults to `create`; `update`
  and `delete` need the file's current blob `sha`.
- `deleteRepo({org, repo})`, `deleteOrg({org})`: teardown. `deleteOrg` deletes the org's
  repositories first, then the org (Gitea rejects deleting an org that still owns repos).

`createOrg` and `createConnectedOrg` are self-cleaning: if a step fails after the org is
created (team, webhook, or the connect call), they delete the half-built org before
rethrowing, so a failed run leaves no orphan org in the shared instance.

Platform side (through the product route):

- `connectGiteaOrg({workspaceId, org, sessionToken})`: `POST
  /integrations/gitea/connections`, authenticated with the suite user's session token.
  Returns the connection DTO.

Convenience:

- `createConnectedOrg({workspaceId, sessionToken, name?})`: `createOrg` then
  `connectGiteaOrg`, returning `{org, teamId, webhookId, connection}`.
- `createGiteaHelper()` / `giteaHelper`: the factory and the Playwright fixture
  (`gitea`). Compose it with the other helpers:

  ```ts
  import {test as base, expect} from '@shipfox/e2e-core/playwright';
  import {type GiteaFixtures, giteaHelper} from '@shipfox/e2e-driver-gitea';

  export const test = base.extend<GiteaFixtures>({...giteaHelper});
  ```

## Configuration

Defaults match `dev/gitea/bootstrap.sh`, so the helper works against local compose Gitea
with no environment set.

| Variable | Default | Purpose |
| --- | --- | --- |
| `E2E_GITEA_URL` | `http://localhost:3000` | Gitea instance, seen from the test host. |
| `E2E_GITEA_ADMIN_USERNAME` | `gitea-admin` | Site admin the helper authenticates as. |
| `E2E_GITEA_ADMIN_PASSWORD` | `gitea-admin-dev-password` | Site admin password (Basic auth). |
| `E2E_GITEA_BOT_USERNAME` | `shipfox-bot` | Read-only bot added to each run org's team. |
| `E2E_GITEA_WEBHOOK_SECRET` | `shipfox-gitea-dev-webhook-secret` | Secret on the org push webhook; must match the API's `GITEA_WEBHOOK_SECRET`. |
| `E2E_API_HOST_FROM_CONTAINER` | `host.docker.internal` | Host the Gitea container uses to reach the API when delivering webhooks. |

The webhook target URL is derived from the API URL (`@shipfox/e2e-core`'s `API_URL`),
swapping the host for `E2E_API_HOST_FROM_CONTAINER` and keeping the scheme and port.
