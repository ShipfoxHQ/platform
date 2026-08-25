import {closePostgresClient, createPostgresClient, isPostgresHealthy, pgClient} from './index.js';

describe('Postgres client', () => {
  afterEach(async () => {
    await closePostgresClient();
  });

  it('rejects duplicate initialization without replacing the pool', () => {
    const pool = createPostgresClient();

    const act = () => createPostgresClient();

    expect(act).toThrow('Postgres client has already been created');
    expect(pgClient()).toBe(pool);
  });

  it('clears the pool after shutdown', async () => {
    createPostgresClient();

    await closePostgresClient();
    const act = () => pgClient();

    expect(act).toThrow('Postgres client has not been created');
  });

  it('waits for open connections to close during shutdown', async () => {
    const pool = createPostgresClient();
    await pool.query('SELECT 1');
    const remove = vi.fn();
    pool.on('remove', remove);

    await closePostgresClient();

    expect(remove).toHaveBeenCalledOnce();
  });

  it('reports a successful health query', async () => {
    const pool = createPostgresClient();
    vi.spyOn(pool, 'query').mockResolvedValue({rowCount: 1} as never);

    const healthy = await isPostgresHealthy();

    expect(healthy).toBe(true);
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });
});
