import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db, migrationsPath} from '#db/index.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_workspaces');
  await db().execute(
    sql`TRUNCATE workspaces_admin_command_results, workspaces_outbox, workspaces_rate_limits, workspaces_workspaces CASCADE`,
  );

  closeDb();
  await closePostgresClient();
}
