import {sql} from 'drizzle-orm';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {migrate} from 'drizzle-orm/node-postgres/migrator';

const DRIZZLE_MIGRATION_LOCK_NAMESPACE = 1936287585;
const DRIZZLE_MIGRATION_LOCK_KEY = 1634890862;

export async function runMigrations<T extends Record<string, unknown>>(
  database: NodePgDatabase<T>,
  migrationsFolder: string,
  migrationsTable?: string,
): Promise<void> {
  await database.transaction(async (tx) => {
    // Drizzle creates its migrations schema/table outside its own migration transaction.
    // Serialize migrators so parallel package tests do not race on that shared setup.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${DRIZZLE_MIGRATION_LOCK_NAMESPACE}, ${DRIZZLE_MIGRATION_LOCK_KEY})`,
    );
    await migrate(tx as unknown as NodePgDatabase<T>, {
      migrationsFolder,
      ...(migrationsTable ? {migrationsTable} : {}),
    });
  });
}
