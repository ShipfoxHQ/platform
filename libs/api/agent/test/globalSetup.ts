import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db, migrationsPath} from '#db/index.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_agent');
  await db().execute(sql`TRUNCATE agent_model_provider_configs CASCADE`);
  await db().execute(sql`TRUNCATE agent_workspace_settings CASCADE`);
  await db().execute(sql`TRUNCATE agent_sessions CASCADE`);
  await db().execute(sql`TRUNCATE agent_data_keys CASCADE`);

  closeDb();
  await closePostgresClient();
}
