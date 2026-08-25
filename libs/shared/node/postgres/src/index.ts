import pg from 'pg';
import {config} from './config.js';
import {createPoolConfig} from './pool-config.js';

export type * from 'pg';

export {DatabaseError} from 'pg';

let _pool: pg.Pool | undefined;

async function closePoolConnections(pool: pg.Pool): Promise<void> {
  const connectionCount = pool.totalCount;
  if (connectionCount === 0) {
    await pool.end();
    return;
  }

  let removedConnectionCount = 0;
  let resolveConnectionsClosed: (() => void) | undefined;
  const connectionsClosed = new Promise<void>((resolve) => {
    resolveConnectionsClosed = resolve;
  });
  const onRemove = () => {
    removedConnectionCount += 1;
    if (removedConnectionCount === connectionCount) resolveConnectionsClosed?.();
  };
  pool.on('remove', onRemove);

  try {
    // Pool.end() clears idle clients before their underlying connections emit `end`.
    await pool.end();
    await connectionsClosed;
  } finally {
    pool.off('remove', onRemove);
  }
}

export function createPostgresClient(options?: pg.PoolConfig): pg.Pool {
  if (_pool) {
    throw new Error('Postgres client has already been created');
  }

  _pool = new pg.Pool(createPoolConfig(config, options));
  return _pool;
}

export function pgClient(): pg.Pool {
  if (!_pool) {
    throw new Error('Postgres client has not been created');
  }
  return _pool;
}

export async function withPostgresSession<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    host: config.POSTGRES_DIRECT_HOST ?? config.POSTGRES_HOST,
    port: config.POSTGRES_PORT,
    database: config.POSTGRES_DATABASE,
    user: config.POSTGRES_USERNAME,
    password: config.POSTGRES_PASSWORD,
    keepAlive: true,
    connectionTimeoutMillis: config.POSTGRES_CONNECTION_TIMEOUT_MS,
    ssl: config.POSTGRES_TLS_MODE === 'verify-full' ? {rejectUnauthorized: true} : false,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function closePostgresClient() {
  if (!_pool) return;

  await closePoolConnections(_pool);
  _pool = undefined;
}

export async function isPostgresHealthy() {
  if (!_pool) return false;
  try {
    const health = await _pool?.query('SELECT 1');
    return health.rowCount === 1;
  } catch (_err) {
    return false;
  }
}
