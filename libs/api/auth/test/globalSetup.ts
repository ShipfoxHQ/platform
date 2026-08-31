import './env.js';
import {
  initializeEmailChallengesForTests,
  resetEmailChallengesForTests,
} from '@shipfox/api-email-challenges/test';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_auth');
  await initializeEmailChallengesForTests();
  await resetEmailChallengesForTests();
  await db().execute(
    sql`TRUNCATE auth_agent_pats, auth_agent_refresh_tokens, auth_agent_authorization_codes, auth_agent_grants, auth_agent_authorization_requests, auth_agent_clients, auth_admin_command_results, auth_admin_grants, auth_outbox, auth_password_resets, auth_rate_limits, auth_refresh_tokens, auth_users CASCADE`,
  );

  closeDb();
  await closePostgresClient();
}
