process.env.POSTGRES_HOST ??= 'localhost';
process.env.POSTGRES_PORT ??= '5432';
process.env.POSTGRES_USERNAME ??= 'shipfox';
process.env.POSTGRES_PASSWORD ??= 'password';
process.env.POSTGRES_DATABASE = 'api_test';
process.env.POSTGRES_MAX_CONNECTIONS ??= '5';
process.env.TZ = 'UTC';
process.env.SECRETS_ENCRYPTION_KEK = 'ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=';
process.env.AGENT_SESSION_ENCRYPTION_KEK = 'ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=';

// Real Garage dev credentials (bootstrap.sh creates the shipfox-agent-sessions-test
// bucket and grants this key). Artifact store tests upload to and read back from live
// Garage from compose.yml.
process.env.AGENT_SESSION_STORAGE_S3_ENDPOINT ??= 'http://localhost:3900';
process.env.AGENT_SESSION_STORAGE_S3_REGION = 'garage';
process.env.AGENT_SESSION_STORAGE_S3_BUCKET = 'shipfox-agent-sessions-test';
process.env.AGENT_SESSION_STORAGE_S3_ACCESS_KEY_ID = 'GK000000000000000000000000';
process.env.AGENT_SESSION_STORAGE_S3_SECRET_ACCESS_KEY =
  '0000000000000000000000000000000000000000000000000000000000000000';
process.env.AGENT_SESSION_STORAGE_S3_FORCE_PATH_STYLE = 'true';
