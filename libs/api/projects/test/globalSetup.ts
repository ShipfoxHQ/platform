import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db, migrationsPath} from '#db/index.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_projects');
  await db().execute(sql`TRUNCATE projects_projects CASCADE`);
  await db().execute(sql`TRUNCATE projects_outbox CASCADE`);

  closeDb();
  await closePostgresClient();
}
