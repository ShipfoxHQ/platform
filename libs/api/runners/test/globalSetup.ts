import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db, migrationsPath} from '#db/index.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_runners');
  await db().execute(sql`TRUNCATE runners_runner_tokens CASCADE`);
  await db().execute(sql`TRUNCATE runners_pending_jobs CASCADE`);
  await db().execute(sql`TRUNCATE runners_running_jobs CASCADE`);
  await db().execute(sql`TRUNCATE runners_outbox CASCADE`);

  closeDb();
  await closePostgresClient();
}
