import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db, migrationsPath} from '#db/index.js';

export async function setup() {
  createPostgresClient();

  await db().execute(sql`DROP TABLE IF EXISTS definitions_workflow_definitions CASCADE`);
  await db().execute(sql`DROP TABLE IF EXISTS definitions_outbox CASCADE`);
  await db().execute(sql`DROP TYPE IF EXISTS definitions_source CASCADE`);
  await db().execute(sql`DROP TABLE IF EXISTS __drizzle_migrations_definitions CASCADE`);
  await db().execute(sql`DROP TABLE IF EXISTS drizzle.__drizzle_migrations_definitions CASCADE`);
  await runMigrations(db(), migrationsPath, '__drizzle_migrations_definitions');
  await db().execute(sql`TRUNCATE TABLE definitions_workflow_definitions CASCADE`);
  await db().execute(sql`TRUNCATE TABLE definitions_outbox CASCADE`);

  closeDb();
  await closePostgresClient();
}
