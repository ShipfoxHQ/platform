# Shipfox Outbox

Typed outbox helpers for Shipfox modules. Use this package when a database write needs to record a domain event in the same transaction.

## What it does

- **`createOutboxTable(pgTable)`**: Creates a Drizzle table named `outbox` for a module table namespace.
- **`writeOutboxEvent(tx, outboxTable, event)`**: Inserts a typed event into an outbox table.
- **`DomainEvent`**: Runtime event shape used by dispatchers.
- **`EventMapLike`, `EventType`, `EventPayload`**: Type helpers for module event maps.

## Usage

```ts
import {createOutboxTable, writeOutboxEvent} from '@shipfox/node-outbox';
import {pgTableCreator} from 'drizzle-orm/pg-core';

const pgTable = pgTableCreator((name) => `projects_${name}`);
export const outbox = createOutboxTable(pgTable);

interface ProjectEventMap {
  'project.created': {projectId: string};
}

await db.transaction(async (tx) => {
  await tx.insert(projects).values({id: projectId});
  await writeOutboxEvent<ProjectEventMap>(tx, outbox, {
    type: 'project.created',
    payload: {projectId},
  });
});
```

The table includes a pending-event index on `created_at` for rows where `dispatched_at` is null.

## Development

```sh
turbo check --filter=@shipfox/node-outbox
turbo type --filter=@shipfox/node-outbox
```

## License

MIT
