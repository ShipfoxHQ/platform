process.env.POSTGRES_HOST ??= 'localhost';
process.env.POSTGRES_PORT ??= '5432';
process.env.POSTGRES_USERNAME ??= 'shipfox';
process.env.POSTGRES_PASSWORD ??= 'password';
process.env.POSTGRES_DATABASE = 'api_test';
process.env.POSTGRES_MAX_CONNECTIONS ??= '5';
process.env.AUTH_ROOT_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.SECRETS_ENCRYPTION_KEK = 'ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=';

// Small accrual budget so cap/budget tests use tiny payloads: base 100 bytes,
// rate 60 bytes/min (1 byte/second).
process.env.LOG_BUDGET_BASE_BYTES = '100';
process.env.LOG_BUDGET_RATE_BYTES_PER_MINUTE = '60';

// Modest body limit (64 KiB) so the route 413 test uses a small payload.
process.env.LOG_APPEND_BODY_LIMIT_BYTES = '65536';

// Small agent_session line cap so the over-cap test uses a tiny payload. Must stay
// <= LOG_APPEND_BODY_LIMIT_BYTES for the startup invariant.
process.env.LOG_MAX_SESSION_LINE_BYTES = '512';

// Tiny inline read page so the read-path drain/has_more test pages with small fixtures.
process.env.LOG_READ_INLINE_MAX_BYTES = '256';

// Real Garage dev credentials. Compaction tests use the logs prefix in the shared
// test bucket that bootstrap.sh creates.
process.env.OBJECT_STORAGE_S3_ENDPOINT ??= 'http://localhost:3900';
process.env.OBJECT_STORAGE_S3_REGION = 'garage';
process.env.OBJECT_STORAGE_S3_BUCKET = 'shipfox-test';
process.env.OBJECT_STORAGE_S3_ACCESS_KEY_ID = 'GK000000000000000000000000';
process.env.OBJECT_STORAGE_S3_SECRET_ACCESS_KEY =
  '0000000000000000000000000000000000000000000000000000000000000000';
process.env.OBJECT_STORAGE_S3_FORCE_PATH_STYLE = 'true';

process.env.TZ = 'UTC';
