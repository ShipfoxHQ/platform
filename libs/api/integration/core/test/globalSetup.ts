import './env.js';
import {
  db as githubDb,
  migrationsPath as githubMigrationsPath,
} from '@shipfox/api-integration-github';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_integrations');
  await runMigrations(githubDb(), githubMigrationsPath, '__drizzle_migrations_integrations_github');
  await db().execute(sql`TRUNCATE integrations_connections CASCADE`);

  closeDb();
  await closePostgresClient();
}
