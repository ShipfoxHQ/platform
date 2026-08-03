# Shipfox Drizzle

Helpers for using Drizzle with PostgreSQL in Node.js services.

## What it does

- **`drizzle`**: Exports the Drizzle driver for `node-postgres`.
- **`NodePgDatabase`**: Exports the matching database type.
- **`runMigrations()`**: Runs migrations in a transaction. It uses a PostgreSQL advisory lock.
- **`uuidv7PrimaryKey()`**: Makes a UUID primary key with a `uuidv7()` default.
- **Cursor helpers**: Encode, decode, filter, and page through keyset cursors.

## Installation

Use Node.js 24 or newer. Use PostgreSQL 18.

```sh
pnpm add @shipfox/node-drizzle @shipfox/node-postgres drizzle-orm
```

## Usage

```ts
import {drizzle, runMigrations, uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {createPostgresClient} from '@shipfox/node-postgres';
import {pgTable, text} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuidv7PrimaryKey(),
  email: text('email').notNull(),
});

const pool = createPostgresClient();
const db = drizzle(pool);
await runMigrations(db, './drizzle', '__drizzle_migrations_users');
```

## Behavior notes

- `uuidv7PrimaryKey()` uses the built-in `uuidv7()` function. That function needs PostgreSQL 18.
- Give each module its own migration table when modules share a database. Their histories stay separate.
- Connect straight to the database for migrations. Do not use a transaction pool or serverless pool.
- The advisory lock lets only one process set up migration tables at a time.

## Development

```sh
turbo check --filter=@shipfox/node-drizzle
turbo type --filter=@shipfox/node-drizzle
turbo type:emit --filter=@shipfox/node-drizzle
turbo build --filter=@shipfox/node-drizzle
turbo test --filter=@shipfox/node-drizzle
```

## License

MIT
