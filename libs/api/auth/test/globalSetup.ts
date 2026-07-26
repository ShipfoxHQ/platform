import './env.js';
import {initializeEmailChallengesForTests} from '@shipfox/api-email-challenges/test';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_auth');
  await initializeEmailChallengesForTests();
  await db().execute(
    sql`TRUNCATE auth_admin_grants, auth_outbox, auth_password_resets, auth_rate_limits, auth_refresh_tokens, auth_users CASCADE`,
  );

  closeDb();
  await closePostgresClient();
}
