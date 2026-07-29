import {createConfig, host, num, str} from '@shipfox/config';

export const postgresConfigSchema = {
  POSTGRES_HOST: host({
    desc: 'Hostname of the PostgreSQL server. Use the pooled hostname for application traffic and the direct hostname for migrations.',
    default: 'localhost',
  }),
  POSTGRES_DIRECT_HOST: host({
    desc: 'Optional direct PostgreSQL hostname for session-scoped operations such as advisory locks. Set this when POSTGRES_HOST uses transaction pooling.',
    default: undefined,
  }),
  POSTGRES_PORT: num({
    desc: 'Port of the PostgreSQL server.',
    default: 5432,
  }),
  POSTGRES_USERNAME: str({
    desc: 'Username used to connect to PostgreSQL.',
    default: 'shipfox',
  }),
  POSTGRES_PASSWORD: str({
    desc: 'Password used to connect to PostgreSQL. Set a strong value in production.',
    default: 'password',
  }),
  POSTGRES_DATABASE: str({
    desc: 'Name of the PostgreSQL database to use.',
    default: 'api',
  }),
  POSTGRES_MAX_CONNECTIONS: num({
    desc: 'Largest number of connections the pool keeps open. Higher values allow more queries at once but use more resources.',
    default: 10,
  }),
  POSTGRES_CONNECTION_TIMEOUT_MS: num({
    desc: 'How long the pool waits to connect before it reports an error, in milliseconds. Use 0 to wait without a timeout.',
    default: 5_000,
  }),
  POSTGRES_IDLE_TIMEOUT_MS: num({
    desc: 'How long an unused connection stays open, in milliseconds. Use 0 to keep idle connections open.',
    default: 10_000,
  }),
  POSTGRES_TLS_MODE: str({
    desc: 'How the client secures the PostgreSQL connection. Use disable for local development or verify-full to verify the certificate and hostname.',
    choices: ['disable', 'verify-full'] as const,
    default: 'disable' as const,
  }),
};

export function loadPostgresConfig(update?: Partial<NodeJS.ProcessEnv>) {
  const loadedConfig = createConfig(postgresConfigSchema, update);

  validateTimeout('POSTGRES_CONNECTION_TIMEOUT_MS', loadedConfig.POSTGRES_CONNECTION_TIMEOUT_MS);
  validateTimeout('POSTGRES_IDLE_TIMEOUT_MS', loadedConfig.POSTGRES_IDLE_TIMEOUT_MS);

  return loadedConfig;
}

export type PostgresConfig = ReturnType<typeof loadPostgresConfig>;

export const config = loadPostgresConfig();

function validateTimeout(name: string, value: number) {
  if (value < 0) {
    throw new Error(`${name} must be 0 or greater`);
  }
}
