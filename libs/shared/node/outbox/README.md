# Shipfox Outbox

Typed transactional outbox helpers for Drizzle and PostgreSQL.

## What it does

- **Legacy module helpers**: `createOutboxTable`, `writeOutboxEvent`, and `writeOutboxEvents` keep the current Shipfox module contract.
- **`createPostgresOutboxTable(pgTable)`**: Creates an outbox table with idempotency keys and delivery leases.
- **`writeIdempotentOutboxEvent(tx, table, event)`**: Adds one event inside a Drizzle transaction and reports if the key was new.
- **`createPostgresOutbox(options)`**: Claims events, records retries, rejects stale deliveries, and reports pending age.
- **`DomainEvent`**: Runtime event shape used by dispatchers.
- **`EventMapLike`, `EventType`, `EventPayload`**: Type helpers for module event maps.

## Public API

Import the supported API from `@shipfox/node-outbox`. The package has no public subpath exports.

The runtime exports are `PostgresOutbox`, `createPostgresOutbox`, `createPostgresOutboxTable`, `writeIdempotentOutboxEvent`, and the behavior-preserving legacy exports `createOutboxTable`, `writeOutboxEvent`, and `writeOutboxEvents`. The root also exports the matching option, event, result, health, table, and event-map types used by those functions. Query construction and internal serialization helpers are not public.

## Installation

Use Node.js 24 or newer. Use PostgreSQL 18.

```sh
pnpm add @shipfox/node-outbox @shipfox/node-drizzle drizzle-orm
```

## Usage

```ts
import {
  createPostgresOutbox,
  createPostgresOutboxTable,
  writeIdempotentOutboxEvent,
} from '@shipfox/node-outbox';
import {pgTableCreator} from 'drizzle-orm/pg-core';

const pgTable = pgTableCreator((name) => `projects_${name}`);
const outboxTable = createPostgresOutboxTable(pgTable);
const outbox = createPostgresOutbox({database: db, table: outboxTable});

await db.transaction(async (tx) => {
  await tx.insert(projects).values({id: projectId});
  await writeIdempotentOutboxEvent(tx, outboxTable, {
    idempotencyKey: `project-created:${projectId}`,
    type: 'project.created',
    payload: {projectId},
  });
});

const [delivery] = await outbox.claim({batchSize: 100, leaseDurationMs: 30_000});
if (delivery) await outbox.acknowledge(delivery);
```

## Data model

`createPostgresOutboxTable` creates an `outbox` table in the given table namespace.
It needs PostgreSQL 18 because that release added the built-in `uuidv7()` function used by its primary key.

| Columns | Purpose |
| --- | --- |
| `id`, `idempotency_key` | Keep the row key separate from the caller's unique event key. |
| `event_type`, `ordering_key`, `payload`, `created_at` | Store the event and its order group. |
| `lease_token`, `lease_expires_at` | Give one delivery attempt time-bound authority. |
| `dispatch_attempts`, `next_dispatch_at` | Count claims and schedule retries. |
| `last_dispatch_error`, `last_dispatch_failed_at` | Store the last failure. |
| `dispatched_at`, `dead_lettered_at` | Store terminal delivery state. |

## Behavior notes

- Insert an outbox event through the same Drizzle transaction as the domain write. A rollback then removes both writes.
- The caller owns each stable idempotency key. Reusing a key keeps the first event and returns `duplicate`.
- Claims use `FOR UPDATE SKIP LOCKED`. Concurrent workers receive different rows.
- A non-empty ordering key blocks newer events in the same group until the oldest event finishes.
- Each claim increments `dispatch_attempts` and gets a new lease token.
- Acknowledgement and retry require the current unexpired token. A stale call returns `stale` and changes nothing.
- `maxAttempts` defaults to 5. The last failed attempt moves the event to the dead letter state.
- `maxRetryDelayMs` defaults to 30 minutes. Longer retry delays use that limit.
- `createOutboxTable` stays separate, so current Shipfox modules need no schema or source change.

## Connections and Migrations

- Create and migrate the table before application startup. The package defines the Drizzle table but does not run migrations.
- Use a direct PostgreSQL connection for migrations. Do not run migrations through a transaction pooler or serverless pool.
- Runtime writes and dispatch may use a direct connection or a pool. The connection layer must keep each Drizzle transaction on one PostgreSQL connection and support `FOR UPDATE SKIP LOCKED`.
- `createPostgresOutboxTable` uses PostgreSQL 18's built-in `uuidv7()` function. Older PostgreSQL versions are not supported.

## Health and Shutdown

`outbox.health()` checks database access and returns the pending count and oldest pending event age. It rejects database failures. It does not prove that a dispatcher is running, so monitor worker liveness separately.

For a graceful shutdown, stop starting claims, let active deliveries finish, and then close the database pool. If a worker exits with an active delivery, do not acknowledge it during shutdown. Its lease expires and another worker can claim it with a new token. Choose a lease duration longer than normal delivery time and shorter than the maximum acceptable recovery delay.

## Development

```sh
turbo check --filter=@shipfox/node-outbox
turbo type --filter=@shipfox/node-outbox
turbo type:emit --filter=@shipfox/node-outbox
turbo build --filter=@shipfox/node-outbox
turbo test --filter=@shipfox/node-outbox
```

The PostgreSQL contract tests need the local PostgreSQL 18 service. Start it with `docker compose up -d`.

## License

MIT
