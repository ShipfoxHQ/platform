# Shipfox API Workspaces

Shipfox API Workspaces manages who can use a workspace and send or accept invites.

## What it does

- **`createWorkspacesModule`**: Adds table changes, API routes, outbox events, and metrics.
- **`ensureMembership`**: Adds a user to a workspace or returns the row that is there.
- **Invitation helpers**: Make, view, accept, list, and revoke invites.
- **Workspace helpers**: Read workspaces and check a signed-in user's access.

## Installation / Setup

```sh
pnpm add @shipfox/api-workspaces
```

Set `CLIENT_BASE_URL` to the public client URL. Invite emails use this URL for
their accept links. Configure `@shipfox/node-mailer` when invite email must be sent.

## Usage

Call `ensureMembership` after an identity callback has the user profile:

```ts
import {ensureMembership} from '@shipfox/api-workspaces';

const membership = await ensureMembership({
  userId: user.id,
  userEmail: user.email,
  userName: user.name,
  workspaceId,
});
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLIENT_BASE_URL` | `http://localhost:5173` | Base URL used in workspace invitation links. |

Invitation email uses the shared `@shipfox/node-mailer` configuration.

## Routes / API / Data Model

Routes mount under `/workspaces`. They make and list workspaces, manage members,
and make, list, view, accept, or revoke invites. The composed module also mounts
`GET /admin/workspaces`, which requires the Auth `admin-observer` role and returns
bounded workspace identity, lifecycle, member, project, and best-effort job-count
summaries. Supporting count failures are represented as `unknown`. `POST
/admin/workspaces/:workspaceId/suspend` and `POST
/admin/workspaces/:workspaceId/reactivate` require the `admin-operator` role, an
`Idempotency-Key` header, and a `{reason}` body, and return `{workspace_id,
status, correlation_id}`. Both write a redacted `administration.action.performed`
outbox event and record their result for idempotent retries.

The module creates these tables:

- `workspaces`
- `workspaces_memberships`
- `workspaces_invitations`
- `workspaces_outbox`
- `workspaces_admin_command_results`

## Behavior Notes

`ensureMembership` uses a unique database rule to keep one row for `user_id`
and `workspace_id`. Calls at the same time get the same row. It saves the email
and name only for a new row. Later calls do not change saved values. The metric
counts only new rows.

Invite acceptance keeps its current transaction. It does not change a row that
is already there.

`ensureMembership` fails when its workspace does not exist. Workspace checks
throw `WorkspaceNotFoundError` or `MembershipRequiredError`. Invite helpers
throw their exported token and email mismatch errors when an invite cannot be
used.

## Development

```sh
turbo check --filter=@shipfox/api-workspaces
turbo type --filter=@shipfox/api-workspaces
turbo test --filter=@shipfox/api-workspaces
```

For repository test conventions, read the [testing guide](../../../docs/guides/testing.md).

## License

MIT
