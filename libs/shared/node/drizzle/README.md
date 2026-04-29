# Shipfox Drizzle

Small Drizzle helpers for Shipfox Node packages. It wraps Drizzle's PostgreSQL driver and adds a migration runner that is safe to use when tests or services start in parallel.

## What it does

- **`drizzle`**: Re-exports `drizzle-orm/node-postgres`.
- **`runMigrations(database, migrationsFolder, migrationsTable?)`**: Runs Drizzle migrations inside a transaction and takes a PostgreSQL advisory lock before migrating.
- **`uuidv7PrimaryKey()`**: Creates a UUID primary key column that defaults to `uuidv7()`.
- **`NodePgDatabase`**: Re-exported type from Drizzle.

## Usage

```ts
import {drizzle, runMigrations, uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {pgTable, text} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuidv7PrimaryKey(),
  email: text('email').notNull(),
});

const db = drizzle(pool);
await runMigrations(db, './drizzle', '__drizzle_migrations_users');
```

Use a custom migration table name when several modules share one database. This keeps each module's migration history separate.

## Development

```sh
turbo check --filter=@shipfox/node-drizzle
turbo type --filter=@shipfox/node-drizzle
```

## License

MIT
