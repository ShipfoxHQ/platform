import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {checkBucketReachable, closeS3Client} from '#api/object-storage.js';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/index.js';

const BUCKET_READY_TIMEOUT_MS = 30_000;
const BUCKET_READY_POLL_INTERVAL_MS = 500;

// `garage-init` exits 0 once it has posted the key/bucket ACLs, but Garage does not guarantee
// those are immediately usable for S3 uploads. Poll HeadBucket so the suite never starts before
// the store will accept the configured credentials: without this, the compaction tests race the
// ACL propagation and fail with `AccessDenied: No such key`.
async function waitForBucketReachable(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkBucketReachable()) return;
    await new Promise((resolve) => setTimeout(resolve, BUCKET_READY_POLL_INTERVAL_MS));
  }
  if (!(await checkBucketReachable())) {
    throw new Error(
      `Garage bucket not reachable after ${timeoutMs / 1000}s; ` +
        'check that the garage + garage-init compose services are up and the access key is provisioned.',
    );
  }
}

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_logs');
  await db().execute(sql`TRUNCATE logs_chunks CASCADE`);
  await db().execute(sql`TRUNCATE logs_attempt_streams CASCADE`);
  await db().execute(sql`TRUNCATE logs_job_accounting CASCADE`);
  await db().execute(sql`TRUNCATE logs_outbox CASCADE`);

  closeDb();
  await closePostgresClient();

  await waitForBucketReachable(BUCKET_READY_TIMEOUT_MS);
  closeS3Client();
}
