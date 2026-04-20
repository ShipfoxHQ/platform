# Shipfox Postgres

Thin wrapper around `pg` that centralizes connection config via environment variables and exposes a simple lifecycle API for shared pool usage.

It should be used with other packages from [Shipfox](https://www.shipfox.io/).

## What it does

- **createPostgresClient(options?)**: Creates and stores a singleton `pg.Pool` configured from environment variables and optional overrides.
- **pgClient()**: Returns the previously created pool; throws if not initialized.
- **closePostgresClient()**: Closes and clears the pool.
- **isPostgresHealthy()**: Executes a lightweight `SELECT 1` to report readiness.
- **Re-exports all types/exports from `pg`** for direct usage.

Environment variables (with defaults):

- `POSTGRES_HOST` (default: `localhost`)
- `POSTGRES_PORT` (default: `5432`)
- `POSTGRES_USERNAME` (default: `shipfox`)
- `POSTGRES_PASSWORD` (default: `password`)
- `POSTGRES_DATABASE` (default: `api`)

## Installation

```bash
pnpm add @shipfox/node-pg
# or
yarn add @shipfox/node-pg
# or
npm install @shipfox/node-pg
```

## Usage

```ts
import {
  createPostgresClient,
  pgClient,
  closePostgresClient,
  isPostgresHealthy,
  type Pool,
} from "@shipfox/node-pg";

// 1) Create the pool at startup (optionally pass pg.PoolConfig overrides)
const pool: Pool = createPostgresClient({
  // connectionTimeoutMillis: 5000,
  // max: 10,
});

// 2) Use the pool elsewhere without passing it around
async function getServerTime() {
  const client = await pgClient().connect();
  try {
    const res = await client.query("SELECT NOW() AS now");
    return res.rows[0]?.now;
  } finally {
    client.release();
  }
}

// 3) Health check
async function ready() {
  return await isPostgresHealthy();
}

// 4) Clean shutdown
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
```
