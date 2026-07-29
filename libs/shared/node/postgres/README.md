# Shipfox Postgres

PostgreSQL pool setup for Shipfox services and Node.js 24 apps.

## What it does

- **`createPostgresClient(options?)`**: Creates one shared `pg.Pool` from the environment and optional overrides.
- **`pgClient()`**: Returns the shared pool after initialization.
- **`closePostgresClient()`**: Closes and clears the shared pool.
- **`isPostgresHealthy()`**: Runs `SELECT 1` through the shared pool.
- **PostgreSQL exports**: Re-exports `DatabaseError` and the public `pg` types.

## Installation

```sh
pnpm add @shipfox/node-postgres
```

## Usage

```ts
import {
  closePostgresClient,
  createPostgresClient,
  isPostgresHealthy,
  pgClient,
} from '@shipfox/node-postgres';

createPostgresClient();

const result = await pgClient().query('SELECT NOW() AS now');
console.log(result.rows[0]?.now);

const ready = await isPostgresHealthy();
await closePostgresClient();
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `POSTGRES_HOST` | `localhost` | PostgreSQL hostname. |
| `POSTGRES_DIRECT_HOST` | unset | Optional direct PostgreSQL hostname for session-scoped operations such as advisory locks. |
| `POSTGRES_PORT` | `5432` | PostgreSQL port. |
| `POSTGRES_USERNAME` | `shipfox` | PostgreSQL user. |
| `POSTGRES_PASSWORD` | `password` | PostgreSQL password. Set a strong value in production. |
| `POSTGRES_DATABASE` | `api` | PostgreSQL database. |
| `POSTGRES_MAX_CONNECTIONS` | `10` | Largest number of connections in the local pool. |
| `POSTGRES_CONNECTION_TIMEOUT_MS` | `5000` | Time allowed to connect. Set it to `0` to wait without a timeout. |
| `POSTGRES_IDLE_TIMEOUT_MS` | `10000` | Time an unused connection stays open. Set it to `0` to keep idle connections open. |
| `POSTGRES_TLS_MODE` | `disable` | TLS policy. Use `disable` or `verify-full`. |

`verify-full` checks the server certificate and hostname. Use it for a managed production database. Use `disable` for local development.

### Serverless application

Use the provider's pooled hostname for application traffic. A pool size of one limits each serverless instance to one connection. A short idle timeout releases unused connections. This allows the database to scale to zero.

```sh
POSTGRES_HOST=pool.example.com
POSTGRES_PORT=5432
POSTGRES_USERNAME=application
POSTGRES_PASSWORD=replace-me
POSTGRES_DATABASE=application
POSTGRES_MAX_CONNECTIONS=1
POSTGRES_CONNECTION_TIMEOUT_MS=5000
POSTGRES_IDLE_TIMEOUT_MS=10000
POSTGRES_TLS_MODE=verify-full
```

When `POSTGRES_HOST` uses transaction pooling, set `POSTGRES_DIRECT_HOST` to the provider's direct hostname so session-scoped advisory locks remain held for the complete operation.

### Migrations

Use the provider's direct hostname for migrations. Keep the same verified TLS mode.

```sh
POSTGRES_HOST=direct.example.com
POSTGRES_PORT=5432
POSTGRES_USERNAME=migrations
POSTGRES_PASSWORD=replace-me
POSTGRES_DATABASE=application
POSTGRES_MAX_CONNECTIONS=1
POSTGRES_CONNECTION_TIMEOUT_MS=5000
POSTGRES_IDLE_TIMEOUT_MS=10000
POSTGRES_TLS_MODE=verify-full
```

## Behavior Notes

- The environment uses split connection fields. Application and migration processes can select different hosts without parsing a connection URL.
- Caller options still override environment settings for existing consumers.
- A second call to `createPostgresClient()` throws until `closePostgresClient()` completes.
- `isPostgresHealthy()` executes a real query. A health check wakes a suspended database and can delay scale to zero.

## Development

```sh
turbo check --filter=@shipfox/node-postgres
turbo type --filter=@shipfox/node-postgres
turbo test --filter=@shipfox/node-postgres
turbo build --filter=@shipfox/node-postgres
```

## License

MIT
