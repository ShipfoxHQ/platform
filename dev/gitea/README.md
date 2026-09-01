# Local Gitea instance

The Gitea integration provider connects a self-hosted [Gitea](https://about.gitea.com/)
instance: it lists an org's repositories, reads files, hands the runner checkout
credentials, and receives push webhooks. For local development and tests,
`compose.yml` bundles a real Gitea so the provider runs against the same code path
it uses in production, with no throwaway fake git server.

`docker compose up -d` starts Gitea and runs `gitea-init`, which provisions it over
the HTTP API (idempotently): a site-admin user, the low-privilege bot user the
provider authenticates as, a demo org, code-read and issue-comment-write teams the
bot belongs to, the org push webhook, and a few seeded repos carrying the demo
workflow and code files under `dev/gitea/seed/`.

| Setting | Value |
| -- | -- |
| Web / API | `http://localhost:3000` |
| SSH | `ssh://git@localhost:2222` |
| Org | `shipfox` |
| Repos | `demo`, `api`, `runner` |
| Bot user | `shipfox-bot` |
| Bot password (Basic-auth secret) | `shipfox-bot-dev-password` |
| Site admin | `gitea-admin` / `gitea-admin-dev-password` |

The admin and bot credentials are **development-only**. Generate fresh ones for any
shared or self-hosted environment and set the `GITEA_*` variables accordingly (see
`libs/api/integration/gitea/src/config.ts`).

## How the URLs line up

The three URLs the integration relies on each have to be reachable from a different
vantage point:

- **`GITEA_BASE_URL` (`http://localhost:3000`)** is called by the API, which runs on
  the host, so it targets the published port.
- **Clone URL** is derived by Gitea from its `ROOT_URL` (`http://localhost:3000/`).
  The runner also runs on the host in dev, so the published port works there too.
- **Webhook delivery URL** (`http://host.docker.internal:16101/webhooks/integrations/gitea`)
  is called by Gitea from inside its container when it delivers a push, so it targets
  the host rather than `localhost`. `gitea-init` registers the org webhook with this
  URL. Gitea also blocks webhooks to private/loopback hosts by default, so the service
  sets `GITEA__webhook__ALLOWED_HOST_LIST=*` (dev-only).

## Connecting the org

With `INTEGRATIONS_ENABLE_GITEA_PROVIDER=true` (already set in `apps/api/.env`),
connect the `shipfox` org through the API to persist the connection. The org
push webhook is registered by `gitea-init` as admin (the scoped bot cannot manage org
hooks, so the instance admin owns it). The provider then lists the seeded repos and
reads their files; issue tools can read issues and write comments; a push to Gitea
delivers a webhook to the API, verified against `GITEA_WEBHOOK_SECRET`.

## Re-seeding

`gitea-init` skips anything that already exists, so `docker compose up` is safe to
re-run. To start from a clean slate, remove the `gitea` volume (Compose prefixes it
with the project name, which defaults to the repo directory name):

```sh
docker compose down
docker volume rm "$(basename "$PWD")_gitea"
```
