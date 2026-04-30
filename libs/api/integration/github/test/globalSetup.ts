import './env.js';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';

const coreMigrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../core/drizzle');

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), coreMigrationsPath, '__drizzle_migrations_integrations');
  await runMigrations(db(), migrationsPath, '__drizzle_migrations_integrations_github');
  await db().execute(sql`TRUNCATE integrations_connections CASCADE`);

  closeDb();
  await closePostgresClient();
}
