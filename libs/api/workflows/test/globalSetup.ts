import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db, migrationsPath} from '#db/index.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_workflows');
  await db().execute(sql`TRUNCATE workflows_workflow_runs CASCADE`);
  await db().execute(sql`TRUNCATE workflows_outbox CASCADE`);

  closeDb();
  await closePostgresClient();
}
