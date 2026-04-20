import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db, migrationsPath} from '#db/index.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_auth');
  await db().execute(
    sql`TRUNCATE auth_email_verifications, auth_password_resets, auth_refresh_tokens, auth_users CASCADE`,
  );

  closeDb();
  await closePostgresClient();
}
