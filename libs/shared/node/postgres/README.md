# Shipfox Postgres

Thin wrapper around `pg` for Shipfox Node services. It creates one shared pool from environment config and exposes health and shutdown helpers.

## What it does

- **`createPostgresClient(options?)`** creates and stores one `pg.Pool`.
- **`pgClient()`** returns the current pool.
- **`closePostgresClient()`** closes and clears the pool.
- **`isPostgresHealthy()`** runs `SELECT 1`.
- **`DatabaseError` and `pg` types** are re-exported.

Environment variables (with defaults):

- `POSTGRES_HOST` (default: `localhost`)
- `POSTGRES_PORT` (default: `5432`)
- `POSTGRES_USERNAME` (default: `shipfox`)
- `POSTGRES_PASSWORD` (default: `password`)
- `POSTGRES_DATABASE` (default: `api`)
- `POSTGRES_MAX_CONNECTIONS` (default: `10`)

## Installation

```bash
pnpm add @shipfox/node-postgres
# or
yarn add @shipfox/node-postgres
# or
npm install @shipfox/node-postgres
```

## Usage

```ts
import {
  createPostgresClient,
  pgClient,
  closePostgresClient,
  isPostgresHealthy,
  type Pool,
} from "@shipfox/node-postgres";

const pool: Pool = createPostgresClient({
  // connectionTimeoutMillis: 5000,
  // max: 10,
});

async function getServerTime() {
  const client = await pgClient().connect();
  try {
    const res = await client.query("SELECT NOW() AS now");
    return res.rows[0]?.now;
  } finally {
    client.release();
  }
}

async function ready() {
  return await isPostgresHealthy();
}

async function shutdown() {
  await closePostgresClient();
}
```

Configure via environment variables before starting your app:

```bash
export POSTGRES_HOST="127.0.0.1"
export POSTGRES_PORT="5432"
export POSTGRES_USERNAME="service_user"
export POSTGRES_PASSWORD="supersecret"
export POSTGRES_DATABASE="appdb"
export POSTGRES_MAX_CONNECTIONS="10"
```

## Development

```sh
turbo check --filter=@shipfox/node-postgres
turbo type --filter=@shipfox/node-postgres
```

## License

MIT
