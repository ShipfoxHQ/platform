# Webhook retry safety

Shipfox accepts provider webhooks at least once. A queued request can run more
than once. SQS Standard can also run new requests before old ones.

This audit covers handlers that change install state or call another system.
Other event handlers save the provider delivery ID and outbox event in one
database transaction.

## Lifecycle handlers

| Handler | Safety mechanism | Retry result |
| --- | --- | --- |
| GitHub `installation.deleted`, `installation.suspend`, and `installation.new_permissions_accepted` | The transaction returns the workspace and install IDs. Cleanup runs after commit. A duplicate returns the same IDs. Secret deletion is safe to repeat. The approval event leaves the installation active; deletion and suspension do not. | A cleanup error rejects the request. The next run sees the duplicate claim and tries cleanup again. |
| Sentry `installation.created` | A pending row claims the install UUID and code hash before code exchange. A separate `exchange-succeeded` state is written only after a successful exchange. The installed state and delivery record share one transaction. | A retry skips exchange only when the durable success state or an installed row has the same code hash. An ambiguous `access-denied` response stays pending and fails closed. |
| Sentry `installation.deleted` | Deletion writes a tombstone. It also writes one when creation has not arrived. Creation never changes a deleted row. | Repeated or reordered deletes keep the row deleted. A later creation saves its delivery without code exchange. |
| Slack `app_uninstalled` and matching `tokens_revoked` | The handler claims the delivery before the update. It rejects old events. A generation check blocks a revoke that races with reconnect. | Duplicate and stale events save only their delivery claim. They do not revoke the current install. |

## Disconnect handlers

Linear and Slack delete secrets before database records. The connection row
keeps the workspace ID and secret path until secret deletion works.

Database deletion uses one transaction. A secret error leaves all records in
place. A database rollback also keeps the connection handle. The retry repeats
the safe secret deletion and removes the records.

## Handlers with no queued lifecycle state

- GitHub, Linear, and Slack browser callbacks use direct HTTP flows. They do not
  use the stored webhook processor.
- Gitea has no install lifecycle handler.
- Linear webhooks publish domain events but do not change install state.
- Generic webhook connections resolve current connection state but do not change
  it.

## Failure proof

The focused tests inject these failures:

- GitHub installation cleanup after delivery commit, including permission approval, followed by secret-store failure and duplicate retry.
- Sentry code exchange followed by a failed state and delivery transaction. The
  retry continues from the durable exchange checkpoint without exchanging again.
- Sentry rejects a first exchange with `access-denied`. The claim remains pending
  and no delivery is recorded as successful.
- Sentry deletion delivered before creation.
- Linear and Slack secret failure before record deletion.
- Linear and Slack database failure after secret deletion.
- Slack delayed revoke after a newer installation generation.

## Sentry incomplete-install retention

The daily Sentry cleanup uses the latest state-transition time, not the initial
claim time. A slow exchange therefore receives a fresh retention window when it
becomes installed. Pending claims older than the window are deleted so a later
signed creation can claim the UUID again. `exchange-succeeded` and installed rows
are tombstoned because they crossed a verified boundary and must not be revived.

There is no transaction spanning Sentry's code exchange and Shipfox's database.
If the process stops after Sentry spends the code but before Shipfox writes the
success checkpoint, a retry cannot distinguish that event from an invalid or
expired code. It deliberately remains pending and fails closed until retention
releases the abandoned claim; it is never promoted from `access-denied` alone.
