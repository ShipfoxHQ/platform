# Shipfox API Integration Sentry

Shipfox API Integration Sentry receives Sentry App webhooks and publishes
normalized integration events for downstream modules such as triggers and
projects. It also exposes the install/connect flow that links a Sentry
installation to a Shipfox workspace.

## Setup

This package is published as part of the API runtime closure. Install it from
the registry:

```sh
pnpm add @shipfox/api-integration-sentry
```

Enable the provider from the integrations core package with:

```sh
INTEGRATIONS_ENABLE_SENTRY_PROVIDER=true
```

Configure the Sentry App credentials in the API environment:

```sh
SENTRY_APP_CLIENT_ID=
SENTRY_APP_CLIENT_SECRET=
SENTRY_APP_SLUG=
SENTRY_APP_VERIFY_INSTALL=true
SENTRY_UNCLAIMED_INSTALLATION_RETENTION_DAYS=7
```

`SENTRY_APP_CLIENT_SECRET` is the shared secret used to verify inbound webhooks with HMAC-SHA256 (Sentry signs deliveries with it, the provider verifies them).

`SENTRY_UNCLAIMED_INSTALLATION_RETENTION_DAYS` (default 7, minimum 1) is how many days a verified-but-unclaimed installation may sit before the daily cleanup cron tombstones it. Startup fails on a value below 1.

## Webhook Route

The provider mounts this unauthenticated webhook route:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/webhooks/integrations/sentry` | Receives Sentry App webhooks. |

The route verifies the request signature before parsing JSON. It deduplicates
deliveries by Sentry's `Request-ID` header. Malformed JSON, unknown actions,
unknown resources, and events for unknown installations are recorded and
acknowledged with `204` so Sentry does not disable the webhook after repeated
non-2xx responses.

## Events

Issue webhooks publish `INTEGRATION_EVENT_RECEIVED` with the connection slug as `source`.
Downstream trigger payloads receive the normalized `SentryIssuePayload` in
`triggerPayload.data`.

| Event | Sentry issue action |
| --- | --- |
| `issue.created` | `created` |
| `issue.resolved` | `resolved` |
| `issue.assigned` | `assigned` |
| `issue.archived` | `archived` |
| `issue.unresolved` | `unresolved` |

A raw Sentry `ignored` action is normalized to `issue.archived` with
`payload.action: 'archived'`.

## Install / Connect Routes

The provider mounts these authenticated routes (`AUTH_USER` bearer token):

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/integrations/sentry/install` | Returns the Sentry external-install URL for a workspace. |
| `POST` | `/integrations/sentry/connect` | Links a Sentry installation to a workspace after the install redirect. |

Sentry has no `state` parameter in its install redirect, so the workspace is
taken from the request body (`workspace_id`) and authorized against the live
session. `POST /connect` accepts `{workspace_id, code, installation_id}` only.
the organization slug is derived from Sentry after the code exchange, never
trusted from the client. The exchanged token is used in-memory for the optional
verify-install call and then discarded; **no Sentry token is persisted**.

## Sentry App registration

Configure the Sentry App (Settings → Developer Settings → your app):

- **Redirect URL:** point it at the client callback route
  `<client-origin>/integrations/sentry/callback` (for example
  `https://app.shipfox.io/integrations/sentry/callback`, or
  `http://localhost:5173/integrations/sentry/callback` for local development).
  The page reads `code` and `installationId` from the redirect query, asks the
  user to confirm the target workspace, and calls
  `POST /integrations/sentry/connect` with `{workspace_id, code,
  installation_id}`. A redirect `orgSlug`, if present, is used only as display
  copy on the confirm screen; it is never sent to the API. The server derives
  the authoritative org slug from Sentry after the code exchange (the
  `get-installation` call), so a forged slug cannot influence the stored
  connection. This is per-environment configuration:
  each environment's Sentry App must point at that environment's client
  origin, or installs end on sentry.io with nowhere to return to.
- **Webhooks:** enable the **Issue** resource so issue webhooks are delivered.
- **Verify Install:** when enabled, the connect flow issues a
  `PUT /api/0/sentry-app-installations/{installation_id}/` to mark the
  installation installed; mirror the toggle with `SENTRY_APP_VERIFY_INSTALL`.

### Required permissions

Set these under the app's **Permissions** tab. The installation token bakes in
the app's permissions at install time, so **changing a permission requires
reinstalling the app** before the new scope takes effect.

| Permission | Level | Why |
| --- | --- | --- |
| **Organization** | Read | `POST /connect` reads the installation to derive the org slug. Without it, the org lookup returns `403 Forbidden` and connect fails with `access-denied` (422). |
| **Issue & Event** | Read | Required for Sentry to deliver issue webhooks against the installation. |

When a Sentry call is rejected, the API logs a `Sentry API request rejected`
warning with the failing `operation` and the upstream `status` (for example
`{operation: "get-installation", status: 403}`). The client-facing error stays
generic to avoid leaking provider internals, so this log is where you confirm a
missing-permission `403` versus a transient failure.

## Development

Run checks for this package:

```sh
turbo check --filter=@shipfox/api-integration-sentry
turbo type --filter=@shipfox/api-integration-sentry
turbo test --filter=@shipfox/api-integration-sentry
```

For repository test conventions, read the
[testing guide](../../../../docs/guides/testing.md). This package uses the
`api_test` database, set in `test/env.ts`.

## License

MIT
