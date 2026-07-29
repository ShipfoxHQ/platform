import {loadPostgresConfig, postgresConfigSchema} from './config.js';

const ENVIRONMENT_VARIABLE_NAMES = Object.keys(postgresConfigSchema);

let originalEnvironment: Map<string, string | undefined>;

describe('loadPostgresConfig', () => {
  beforeEach(() => {
    originalEnvironment = new Map(
      ENVIRONMENT_VARIABLE_NAMES.map((name) => [name, process.env[name]]),
    );
    for (const name of ENVIRONMENT_VARIABLE_NAMES) delete process.env[name];
  });

  afterEach(() => {
    for (const [name, value] of originalEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('loads the documented defaults', () => {
    const config = loadPostgresConfig();

    expect(config).toMatchObject({
      POSTGRES_HOST: 'localhost',
      POSTGRES_DIRECT_HOST: undefined,
      POSTGRES_PORT: 5432,
      POSTGRES_USERNAME: 'shipfox',
      POSTGRES_PASSWORD: 'password',
      POSTGRES_DATABASE: 'api',
      POSTGRES_MAX_CONNECTIONS: 10,
      POSTGRES_CONNECTION_TIMEOUT_MS: 5_000,
      POSTGRES_IDLE_TIMEOUT_MS: 10_000,
      POSTGRES_TLS_MODE: 'disable',
    });
  });

  it('loads a separate direct hostname for session-scoped operations', () => {
    const config = loadPostgresConfig({POSTGRES_DIRECT_HOST: 'direct.example.com'});

    expect(config.POSTGRES_DIRECT_HOST).toBe('direct.example.com');
  });

  it('rejects an unsupported TLS mode', () => {
    const act = () => loadPostgresConfig({POSTGRES_TLS_MODE: 'require'});

    expect(act).toThrow('process.exit unexpectedly called with "1"');
  });

  it.each([
    'POSTGRES_MAX_CONNECTIONS',
    'POSTGRES_CONNECTION_TIMEOUT_MS',
    'POSTGRES_IDLE_TIMEOUT_MS',
  ] as const)('rejects a non-numeric %s value', (name) => {
    const act = () => loadPostgresConfig({[name]: 'invalid'});

    expect(act).toThrow('process.exit unexpectedly called with "1"');
  });

  it.each([
    'POSTGRES_CONNECTION_TIMEOUT_MS',
    'POSTGRES_IDLE_TIMEOUT_MS',
  ] as const)('rejects a negative %s value', (name) => {
    const act = () => loadPostgresConfig({[name]: '-1'});

    expect(act).toThrow(`${name} must be 0 or greater`);
  });

  it('accepts zero timeout values', () => {
    const config = loadPostgresConfig({
      POSTGRES_CONNECTION_TIMEOUT_MS: '0',
      POSTGRES_IDLE_TIMEOUT_MS: '0',
    });

    expect(config.POSTGRES_CONNECTION_TIMEOUT_MS).toBe(0);
    expect(config.POSTGRES_IDLE_TIMEOUT_MS).toBe(0);
  });
});
